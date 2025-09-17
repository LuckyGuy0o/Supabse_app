'use client';
import { IoIosHome } from "react-icons/io";
import { useState, useEffect } from "react";
import Image from "next/image";
import { createClient } from '@supabase/supabase-js';
import { useRouter } from "next/navigation";

// Supabase Client Setup
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Gallery() {
  const [urls, setUrls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updateId, setUpdateId] = useState(null);
  const [editURL, setEditURL] = useState("");
  const [check, setCheck] = useState(true);
  const router = useRouter();

 // initialization 
  const working = urls.filter(
    url => url.load_status === "ok" && url.ssl_status === "valid"
  );
  const notWorking = urls.filter(
    url => url.load_status !== "ok" || url.ssl_status !== "valid"
  );
  const displayList = check ? working : notWorking;

  // Fetching URLs from Supabase
  const fetchUrls = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("Url_Project").select("*");
    if (error) {
      console.error("Error fetching URLs:", error);
    } else {
      setUrls(data);
    }
    setLoading(false);
  };

  // Real-time Subscription to DB Changes
  useEffect(() => {
    fetchUrls();

    const urlSubscription = supabase
      .channel('url_project_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Url_Project' }, () => {
        fetchUrls();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(urlSubscription);
    };
  }, []);

  // Delete URL
  const handleDelete = async (id) => {
    const { error } = await supabase.from('Url_Project').delete().eq('id', id);
    if (error) {
      console.error("Error deleting URL:", error);
    }
  };

  // Update URL + Trigger Re-verification
  const handleUpdateSave = async () => {
    if (updateId !== null) {
      try {
        // Step 1: Update the URL in Supabase
        const { error } = await supabase
          .from("Url_Project")
          .update({ URLs: editURL })
          .eq("id", updateId);

        if (error) throw error;

        // Step 2: Trigger Puppeteer screenshot + SSL check
        await fetch("/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: editURL }),
        });

        // Step 3: Reset state
        setUpdateId(null);
        setEditURL("");
      } catch (err) {
        console.error("Error updating URL:", err);
      }
    }
  };

  // ✅ UI Rendering
  return (
  <div className="w-screen min-h-screen bg-gradient-to-b from-gray-800 via-gray-900 to-black text-white p-6 font-sans">
    
    {/* Toggle Buttons: Working / Not Working */}
    <div className="pt-4 flex flex-row gap-2 flex-wrap">
      <button 
        onClick={() => setCheck(true)} 
        className="p-4 bg-gray-700 text-white rounded-2xl border-2 border-white hover:bg-gray-600 transition-colors"
      >
        Working URLs
      </button>
      <button 
        onClick={() => setCheck(false)} 
        className="p-4 bg-gray-700 text-white rounded-2xl border-2 border-white hover:bg-gray-600 transition-colors"
      >
        Not Working URLs
      </button>

      <button
        onClick={() => router.push("/")}
        className="p-4 bg-gray-700 text-white rounded-2xl border-2 border-white 
                   hover:bg-gray-600 transition-colors fixed top-10 right-4 z-1 text-3xl"
      >
        <IoIosHome />
      </button>
    </div>

    {/* Conditional Rendering: Loading / List / Empty */}
    {loading ? (
      <div className="text-center mt-12 text-gray-400">Loading gallery...</div>
    ) : displayList.length > 0 ? (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-6">
      
        {displayList.map((item) => (
          <div 
            key={item.id} 
            className={`bg-gray-800 rounded-2xl p-4 flex flex-col items-center shadow-2xl hover:scale-105 transition-transform
              ${item.status === "error" || item.status === "404" ? "border-2 border-red-500" : ""}
            `}
          >
            {/* Screenshot Display */}
            {item.image ? (
              <div className="w-full h-48 relative rounded-lg overflow-hidden shadow-inner">
                <Image
                  src={item.image}
                  alt={`Screenshot of ${item.URLs}`}
                  fill={true}
                  className="object-cover"
                  unoptimized={true}
                />
              </div>
            ) : (
              <div className="w-full h-48 flex items-center justify-center bg-gray-700 rounded-lg text-gray-400 text-center">
                No screenshot yet
              </div>
            )}
            
            {/* URL Link */}
            <a
              href={item.URLs}
              target="_blank"
              rel="#"
              className="mt-4 flex items-center gap-2 break-all
                         bg-gradient-to-r from-red-400 via-blue-500 to-green-400 
                         bg-clip-text text-transparent
                         transition-all duration-4000
                         bg-[length:200%_200%] 
                         hover:animate-gradient "
            >
              {item.URLs}
            </a>
            
          {/* SSL + Status */}
          <div className="mt-2 text-sm font-semibold">
            <span className={
              item.ssl_status === "valid" ? "text-green-400" :
              item.ssl_status === "invalid" ? "text-red-400" :
              "text-yellow-400"
            }>
              SSL Status: {item.ssl_status}
            </span>
          </div>

          {item.ssl_name && (
            <div className="mt-1 text-sm text-gray-300">
              <span className="font-medium">Name:</span> {item.ssl_name}
            </div>
          )}

          {item.ssl_expiry && (
            <div className="mt-1 text-sm text-gray-300">
              <span className="font-medium">Expiry:</span> {item.ssl_expiry}
            </div>
          )}

          {item.load_status && (
            <div className="mt-1 text-sm font-semibold">
              <span className={
                item.load_status === "ok" ? "text-green-400" : "text-red-400"
              }>
                Status: {item.load_status}
              </span>
            </div>
          )}

            {/* Update / Delete Section */}
            {updateId === item.id ? (
              <div className="mt-4 flex flex-col items-center gap-3 w-full">
                <input
                  type="text"
                  value={editURL}
                  onChange={(e) => setEditURL(e.target.value)}
                  className="w-full border border-gray-600 rounded-lg px-3 py-2 text-white bg-gray-900 focus:outline-none focus:border-blue-500"
                />
                <div className="flex gap-2 w-full justify-center">
                  <button 
                    onClick={() => handleUpdateSave(item.id)} 
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex-1"
                  >
                    Save
                  </button>
                  <button 
                    onClick={() => setUpdateId(null)} 
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mt-4">
                <button 
                  onClick={() => handleDelete(item.id)} 
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => {
                    setUpdateId(item.id);
                    setEditURL(item.URLs);
                  }}
                  className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors"
                >
                  Update
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    ) : (
      <div className="text-center mt-12 text-gray-400">
        No URLs to display. Please add some from the home page.
      </div>
    )}
  </div>
);
}