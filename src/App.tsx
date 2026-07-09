import { useState } from "react";
import "./App.css";
import "./styles.css";

function App() {
  const [activeTab, setActiveTab] = useState("stt");

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex font-sans">
      {/* Sidebar */}
      <div className="w-64 bg-gray-800 border-r border-gray-700 p-4">
        <h1 className="text-xl font-bold mb-6 text-white">v3 Settings</h1>
        <nav className="space-y-1">
          {["STT Engine", "LLM Processing", "Hotkeys", "Paste Engine", "History"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab.toLowerCase())}
              className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                activeTab === tab.toLowerCase()
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8">
        <h2 className="text-2xl font-semibold mb-6 capitalize">{activeTab}</h2>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400">Settings panel implementation coming soon...</p>
        </div>
      </div>
    </div>
  );
}

export default App;
