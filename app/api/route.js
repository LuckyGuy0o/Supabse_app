import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import pLimit from 'p-limit';
import https from "https";

// Creating Supabase Client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// SSL verification function
  async function checkSSL(url) {
    return new Promise((resolve) => {
      try {
        const req = https.get(url, (res) => {
          const cert = res.socket.getPeerCertificate();
          let expiryDate = cert?.valid_to || null;
          let commonName = cert?.subject?.CN || null;

          resolve({
            valid: true,
            statusCode: res.statusCode,
            expiryDate,
            commonName,
            error: null
          });
        });

        req.setTimeout(10000, () => {
          req.destroy(new Error("SSL check timeout"));
        });

        req.on("error", (err) => {
          resolve({
            valid: false,
            statusCode: null,
            expiryDate: null,
            commonName: null,
            error: err.message
          });
        });
      } catch (err) {
        resolve({
          valid: false,
          statusCode: null,
          expiryDate: null,
          commonName: null,
          error: err.message
        });
      }
    });
  }

// Main API Handler function 
export async function POST(req) {
  const limit = pLimit(4);

  // Launch browser
  let browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    // Extract URLs from request
    const { urls } = await req.json();

    if (!urls || urls.length === 0) {
      return NextResponse.json({ message: "No URLs provided.", results: [] });
    }

    // Processing each URL
    const results = await Promise.allSettled(
      urls.map((url) =>
        limit(async () => {
          let page;
          try {
            let status = "pending";

            // Normalizing the URL
            let finalUrl = url.startsWith("http://") || url.startsWith("https://")
              ? url.trim()
              : `https://${url.trim()}`;

            // SSL Verification
            const sslResult = await checkSSL(finalUrl);

            if (!sslResult.valid) {
              console.log(`SSL check failed for ${url}: ${sslResult.error}`);
              await supabase
                .from("Url_Project")
                .update({ 
                  image: null, 
                  isValid: false,
                  load_status: status,
                  ssl_status: "ssl_failed"
                })
                .eq("URLs", url);

              return { url, status: "ssl_failed", ssl_status: "ssl_failed", error: sslResult.error };
            }

            // Puppeteer Screenshot generation 
            page = await browser.newPage();
            await page.setViewport({ width: 1920, height: 1080 });

            try {
              const response = await page.goto(finalUrl, { waitUntil: "networkidle2", timeout: 15000 });

              if (!response) {
                status = "no_response"; // site didn't reply at all
              } else {
                const statusCode = response.status();

                if (statusCode >= 200 && statusCode < 400) {
                  status = "ok"; // successful load
                } else if (statusCode >= 400 && statusCode < 500) {
                  status = "client_error"; // site is reachable, frontend error (404, etc.)
                } else if (statusCode >= 500) {
                  status = "server_error"; // site is reachable, but backend failed
                } else {
                  status = "unknown"; // fallback
                }
              }
            } catch (err) {
              if (err.message.includes("ERR_NAME_NOT_RESOLVED")) status = "not_loading";
              else if (err.message.includes("ERR_CONNECTION_REFUSED")) status = "refused";
              else if (err.message.includes("net::ERR_CERT")) status = "ssl_failed";
              else status = "error";
            }

            const screenshotBuffer = await page.screenshot({
              type: "jpeg",
              quality: 60,
              fullPage: false,
            });

            console.log("Screenshot size:", screenshotBuffer.length);

            const fileName = `1s565ba_0/${url.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.jpg`;

            // Uploading the screenshot and filename(processed link) to Supabase Storage
            const { error: uploadError } = await supabase.storage
              .from("screenshot")
              .upload(fileName, screenshotBuffer, {
                contentType: "image/jpeg",
                upsert: false,
              });

            if (uploadError) {
              console.log(`Supabase upload failed: ${uploadError.message}`);
              throw new Error(`Supabase upload failed: ${uploadError.message}`);
            }

            const { data: publicData } = supabase.storage
              .from("screenshot")
              .getPublicUrl(fileName);

            const publicUrl = publicData?.publicUrl || null;

            // Updating Database
            const {data, error: updateError } = await supabase
            .from("Url_Project")
            .update({ 
              image: publicUrl, 
              isValid: true,
              ssl_status: "valid",
              load_status: status,
              ssl_expiry: sslResult.expiryDate,
              ssl_name: sslResult.commonName
            })
            .eq("URLs", url);

            if (updateError) {
              throw new Error(
                `Supabase database update failed: ${updateError.message}`
              );
            }

            return { url, status, ssl_status: "valid", imageUrl: publicUrl };
          } catch (err) {

            // Error Handling
            console.error(`Error processing URL ${url}:`, err);
            await supabase
              .from("Url_Project")
              .update({ 
                image: null, 
                isValid: false,
                ssl_status: "unknown"
              })
              .eq("URLs", url);

            return { url, status: "failed", ssl_status: "unknown", error: err.message };
          } finally {
            if (page) await page.close();
          }
        })
      )
    );

    // Closing browser after processing
    if (browser) await browser.close();

    return NextResponse.json({ message: "Processing completed.", results });
  } catch (err) {

    // API Handler Error
    console.error("API route handler error:", err);
    if (browser) await browser.close();
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
