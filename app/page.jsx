'use client';
import { useState, useEffect } from "react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Home() {
  const [newURL, setNewURL] = useState("");
  const [urls, setUrls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();

// Fetching all URLs on load to populate the local state
useEffect(() => {
  const fetchUrls = async () => {
    const { data, error } = await supabase
      .from("Url_Project")
      .select("*");   // fetching everything

      if (!error && data) setUrls(data);
      else console.error("Fetch error:", error);
    };
    fetchUrls();
  }, []);

  // Displays a temporary message to the user
  const showMessage = (text) => {
    setMessage(text);
    setTimeout(() => setMessage(""), 5000); 
  };

  // Add a single URL and trigger screenshot generation
  async function handleAddURL(e) {
    e.preventDefault();
    if (!newURL.trim()) {
      showMessage("Please enter a valid URL.");
      return;
    }

    setLoading(true);
    let trimmedURL = newURL.trim();

    if (!/^https?:\/\//i.test(trimmedURL)) {
    trimmedURL = "https://" + trimmedURL;
    }

    // Check if URL already exists in the database
    const { data: existingUrls, error: fetchError } = await supabase
      .from("Url_Project")
      .select("URLs")
      .eq("URLs", trimmedURL);

    if (fetchError) {
      console.error("Fetch error:", fetchError);
    }

    if (existingUrls && existingUrls.length > 0) {
      setLoading(false);
      showMessage("URL already exists.");
      return;
    }

    const { data, error } = await supabase
      .from("Url_Project")
      .insert({ URLs: trimmedURL, image: null, isValid: false, ssl_status: "pending" })
      .select();

    if (error) {
      console.error(error);
      showMessage("Error adding URL.");
    } else {
      // Update local state and show success message.
      setUrls(prev => [...prev, ...data]);
      setNewURL("");
      showMessage("URL added successfully! Screenshot generation started.");

      // Trigger screenshot API for this single new URL
      try {
        const res = await fetch("/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: [trimmedURL] }),
        });
        const result = await res.json();
        console.log("Screenshot generated for new URL:", result);
      } catch (err) {
        console.error("Screenshot API error:", err);
        showMessage("Screenshot API failed.");
      }
    }
    setLoading(false);
  }

  // Export all URLs to a CSV file
  const handleExportCSV = () => {
    if (urls.length === 0) {
      showMessage("No data to export.");
      return;
    }
    const csv = Papa.unparse(urls);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "urls_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Import URLs from a CSV file
  const handleImportCSV = () => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".csv";

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          setLoading(true);

          try {
            //remove id if present, add default values
           const cleanedData = results.data.map(({ id, ...rest }) => ({ 
              ...rest, 
              image: null, 
              isValid: false,
              ssl_status: "pending"
            }));

            // Remove duplicates already in state
            const uniqueURLs = new Set(urls.map((u) => u.URLs));
          
            const newUrlsToInsert = cleanedData.filter(
              (d) => d.URLs && !uniqueURLs.has(d.URLs) 
            );

            if (newUrlsToInsert.length === 0) {
              showMessage("All URLs in the CSV already exist.");
              setLoading(false);
              return;
            }

            // Insert into Supabase
            const { data, error } = await supabase
              .from("Url_Project")
              .insert(newUrlsToInsert)
              .select();

            if (error) {
              console.error("Error importing:", error);
              showMessage("Error importing CSV.");
            } else {
              setUrls((prev) => [...prev, ...data]);
              showMessage("CSV imported successfully! Screenshot generation started.");

              // Call screenshot API
              const urlList = data.map((u) => u.URLs).filter(Boolean);

              if (urlList.length > 0) {
                try {
                  const res = await fetch("/api", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ urls: urlList }),
                  });

                  const result = await res.json();
                  console.log("Screenshots generated for imported URLs:", result);
                } catch (err) {
                  console.error("Screenshot API error for CSV import:", err);
                  showMessage("Screenshot API failed for some URLs.");
                }
              }
            }
          } catch (err) {
            console.error("CSV processing error:", err);
            showMessage("Error while processing CSV.");
          }

          setLoading(false);
        },
      });
    };
    fileInput.click();
  };

  return (
    <div className="w-screen min-h-screen bg-gradient-to-b from-gray-800 via-gray-900 to-black text-white p-6 font-sans">
      <div className="max-w-2xl mx-auto text-center space-y-8">
        <h1 className="text-4xl font-extrabold text-blue-400 drop-shadow-lg">Welcome to SnapSite</h1>
        
        {/* User feedback message */}
        {message && (
          <div className="bg-blue-600 text-white p-3 rounded-lg shadow-md transition-opacity duration-300">
            {message}
          </div>
        )}

        {/* Import/Export buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={handleImportCSV}
            disabled={loading}
            className="px-6 py-3 bg-green-600 rounded-lg text-lg font-semibold shadow-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Import CSV
          </button>
          <button
            onClick={handleExportCSV}
            className="px-6 py-3 bg-blue-600 rounded-lg text-lg font-semibold shadow-md hover:bg-blue-700 transition-colors"
          >
            Export All URLs
          </button>
        </div>

        {/* Add URL Form */}
        <form className="flex flex-col sm:flex-row gap-4 justify-center" onSubmit={handleAddURL}>
          <input
            className="flex-1 border-2 border-gray-600 rounded-lg px-4 py-2 text-white bg-gray-900 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
            type="text"
            placeholder="Enter a URL"
            value={newURL}
            onChange={(e) => setNewURL(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-blue-600 rounded-lg text-lg font-semibold shadow-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add URL
          </button>
        </form>
        
        {/* Continue to Gallery button */}
        <button
          onClick={() => router.push("/Gallery")}
          className="w-full sm:w-auto px-8 py-4 bg-purple-600 rounded-lg text-xl font-bold shadow-lg hover:bg-purple-700 transition-colors transform hover:scale-105"
        >
          View Gallery
        </button>
      </div>
    </div>
  );
}
