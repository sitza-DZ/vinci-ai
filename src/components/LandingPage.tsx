import { useState, useRef, useEffect } from "react";
import { motion } from "motion/react";
import { Film, Lock, Sparkles, Zap, Clapperboard, Wand2, Music, TrendingUp, Eye, EyeOff, ArrowRight } from "lucide-react";

interface LandingPageProps {
  onAuthenticated: () => void;
}

export default function LandingPage({ onAuthenticated }: LandingPageProps) {
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleLogin = async () => {
    if (!pin.trim()) {
      setError("PIN enter karo");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onAuthenticated();
      } else {
        setError(data.error || "Galat PIN — dobara try karo");
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setPin("");
        inputRef.current?.focus();
      }
    } catch (e: any) {
      setError("Server se connect nahi ho paya");
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: Wand2, title: "AI Script Writer", desc: "Topic do, viral script milegi" },
    { icon: Clapperboard, title: "Auto Video Render", desc: "Scenes + transitions + subtitles" },
    { icon: Music, title: "Stock Music by Mood", desc: "Copyright-free BGM, 1-2 min tracks" },
    { icon: TrendingUp, title: "Trend Intelligence", desc: "Trending topics + niche finder" },
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full opacity-30"
          style={{ background: "radial-gradient(circle, rgba(214,41,118,0.25) 0%, rgba(150,47,191,0.12) 40%, transparent 70%)" }} />
      </div>

      {/* Logo + Brand */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center mb-10 relative z-10"
      >
        <div className="w-20 h-20 rounded-3xl ig-logo flex items-center justify-center mx-auto mb-5 shadow-2xl shadow-pink-600/40">
          <Film className="w-9 h-9 text-white" />
        </div>
        <h1 className="font-display font-bold text-4xl tracking-tight text-ink mb-2">
          Vinci <span className="bg-gradient-to-r from-pink-500 via-purple-500 to-amber-400 bg-clip-text text-transparent">AI</span>
        </h1>
        <p className="text-slate-400 text-sm font-mono tracking-wider">AI SHORTS GENERATOR — v12.0 ENGINE</p>
      </motion.div>

      {/* Feature cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10 max-w-3xl w-full relative z-10"
      >
        {features.map((f, i) => (
          <div key={i} className="card p-4 text-center hover:border-pink-500/30 transition-colors">
            <f.icon className="w-5 h-5 text-pink-400 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-200 mb-1">{f.title}</p>
            <p className="text-[10px] text-slate-500 leading-tight">{f.desc}</p>
          </div>
        ))}
      </motion.div>

      {/* PIN Entry Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className={`card p-8 w-full max-w-sm relative z-10 ${shake ? "animate-shake" : ""}`}
      >
        <div className="flex items-center gap-2 mb-6">
          <Lock className="w-4 h-4 text-pink-400" />
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono">Enter PIN</h2>
        </div>

        <div className="relative mb-4">
          <input
            ref={inputRef}
            type={showPin ? "text" : "password"}
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="••••••"
            className="w-full h-12 px-4 pr-12 rounded-xl bg-slate-950 border border-slate-700 text-ink text-lg font-mono tracking-[0.3em] text-center focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/20 transition-all"
            autoComplete="off"
            maxLength={20}
          />
          <button
            onClick={() => setShowPin(!showPin)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            type="button"
          >
            {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {error && (
          <p className="text-xs text-rose-400 font-semibold mb-4 text-center">{error}</p>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="btn btn-primary btn-lg w-full justify-center"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 animate-spin" /> Checking...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Zap className="w-4 h-4" /> Enter Studio <ArrowRight className="w-4 h-4" />
            </span>
          )}
        </button>

        <p className="text-[10px] text-slate-600 text-center mt-4 font-mono">
          🔒 PIN sirf aapke paas hai — koi email/password nahi chahiye
        </p>
      </motion.div>

      {/* Footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="text-[10px] text-slate-600 font-mono mt-8 relative z-10"
      >
        Vinci AI — AI-Powered Short Video Generator
      </motion.p>
    </div>
  );
}
