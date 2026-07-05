import Dashboard from "./pages/Dashboard";
import ThemeToggle from "./components/ui/ThemeToggle";
import "./App.css";

function App() {
  return (
    <>
      <Dashboard />
      {/* Floating so it doesn't require touching Dashboard's header layout */}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 2000 }}>
        <ThemeToggle />
      </div>
    </>
  );
}

export default App;