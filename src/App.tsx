import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import QRCode from "react-qr-code";
import { 
  Shield, 
  Users, 
  Send, 
  Key, 
  Copy, 
  Check, 
  ArrowLeft, 
  Lock, 
  MessageSquare,
  AlertCircle,
  Coffee,
  QrCode,
  EyeOff,
  Timer,
  Trash2
} from "lucide-react";
import { 
  generateKeyPair, 
  exportPublicKey, 
  importPublicKey, 
  deriveSharedSecret, 
  encryptMessage, 
  decryptMessage,
  getFingerprint,
  bufferToBase64,
  base64ToBuffer
} from "./lib/crypto";

type Message = {
  id: string;
  text: string;
  sender: "me" | "them";
  timestamp: number;
};

type AppState = "terms" | "landing" | "hosting" | "joining" | "chatting";

export default function App() {
  const [state, setState] = useState<AppState>("terms");
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPeerConnected, setIsPeerConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  const [selfDestructTime, setSelfDestructTime] = useState(300000); // 5 minutes in ms

  const socketRef = useRef<Socket | null>(null);
  const keyPairRef = useRef<CryptoKeyPair | null>(null);
  const sharedSecretRef = useRef<CryptoKey | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const accepted = localStorage.getItem("cryptic_chat_terms_accepted");
    if (accepted === "true") {
      setHasAcceptedTerms(true);
      setState("landing");
    }
  }, []);

  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on("room-created", (code: string) => {
      setRoomCode(code);
      setState("hosting");
    });

    socketRef.current.on("room-joined", (code: string) => {
      setRoomCode(code);
      setState("chatting");
    });

    socketRef.current.on("peer-joined", async () => {
      setIsPeerConnected(true);
      if (state === "hosting") {
        setState("chatting");
      }
      // Start key exchange
      await initiateKeyExchange();
    });

    socketRef.current.on("receive-public-key", async ({ publicKey, from }: { publicKey: string; from: string }) => {
      console.log("Received public key from peer");
      const peerPublicKey = await importPublicKey(base64ToBuffer(publicKey));
      if (keyPairRef.current) {
        const secret = await deriveSharedSecret(keyPairRef.current.privateKey, peerPublicKey);
        sharedSecretRef.current = secret;
        const fp = await getFingerprint(secret);
        setFingerprint(fp);
        setIsEncrypted(true);
        console.log("Shared secret established");
        
        // If we received a key but haven't sent ours yet (joining), send it now
        if (state === "chatting" && !isEncrypted) {
           await initiateKeyExchange();
        }
      }
    });

    socketRef.current.on("receive-message", async ({ encryptedData, iv }: { encryptedData: string; iv: string }) => {
      if (sharedSecretRef.current) {
        try {
          const decryptedText = await decryptMessage(
            sharedSecretRef.current,
            base64ToBuffer(encryptedData),
            new Uint8Array(base64ToBuffer(iv))
          );
          
          const newMessage: Message = {
            id: Math.random().toString(36).substr(2, 9),
            text: decryptedText,
            sender: "them",
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, newMessage]);
        } catch (err) {
          console.error("Decryption failed", err);
        }
      }
    });

    socketRef.current.on("peer-left", () => {
      setIsPeerConnected(false);
      setIsEncrypted(false);
      setFingerprint(null);
      setError("Peer disconnected");
    });

    socketRef.current.on("error", (msg: string) => {
      setError(msg);
      setTimeout(() => setError(null), 3000);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [state, isEncrypted]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

    // Self-destruct logic
    const timer = setInterval(() => {
      const now = Date.now();
      setMessages((prev) => prev.filter((msg) => now - msg.timestamp < selfDestructTime));
    }, 1000);

    return () => clearInterval(timer);
  }, [messages, selfDestructTime]);

  const initiateKeyExchange = async () => {
    if (!keyPairRef.current) {
      keyPairRef.current = await generateKeyPair();
    }
    const exportedKey = await exportPublicKey(keyPairRef.current.publicKey);
    socketRef.current?.emit("send-public-key", {
      code: roomCode,
      publicKey: bufferToBase64(exportedKey),
    });
  };

  const handleHost = () => {
    socketRef.current?.emit("create-room");
  };

  const handleJoin = () => {
    if (inputCode.length === 6) {
      socketRef.current?.emit("join-room", inputCode);
    } else {
      setError("Please enter a 6-digit code");
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !sharedSecretRef.current) return;

    const text = inputText.trim();
    setInputText("");

    try {
      const { encryptedData, iv } = await encryptMessage(sharedSecretRef.current, text);
      
      socketRef.current?.emit("send-message", {
        code: roomCode,
        encryptedData: bufferToBase64(encryptedData),
        iv: bufferToBase64(iv.buffer),
      });

      const newMessage: Message = {
        id: Math.random().toString(36).substr(2, 9),
        text,
        sender: "me",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, newMessage]);
    } catch (err) {
      console.error("Encryption failed", err);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLeave = () => {
    socketRef.current?.disconnect();
    socketRef.current = io(); // Reconnect for next session
    setState("landing");
    setMessages([]);
    setRoomCode("");
    setInputCode("");
    setIsPeerConnected(false);
    setIsEncrypted(false);
    setFingerprint(null);
    sharedSecretRef.current = null;
    keyPairRef.current = null;
  };

  const handleAcceptTerms = () => {
    localStorage.setItem("cryptic_chat_terms_accepted", "true");
    setHasAcceptedTerms(true);
    setState("landing");
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-orange-500/30">
      {/* Background Grid */}
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#1a1a1a_1px,transparent_1px),linear-gradient(to_bottom,#1a1a1a_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <main className="relative z-10 max-w-lg mx-auto min-h-screen flex flex-col p-4">
        {/* Header */}
        <header className="flex items-center justify-between py-6 mb-8 border-b border-zinc-800/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-black" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">CrypticChat</h1>
          </div>
          <div className="flex items-center gap-3">
            {isEncrypted && (
              <div className="hidden sm:flex flex-col items-end">
                <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                  <Lock className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">E2E Encrypted</span>
                </div>
                {fingerprint && (
                  <span className="text-[9px] font-mono text-zinc-500 mt-1 uppercase tracking-tighter">
                    ID: {fingerprint}
                  </span>
                )}
              </div>
            )}
            {state === "chatting" && (
              <button 
                onClick={handleLeave}
                className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-red-500 transition-colors"
                title="Wipe Session"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
          </div>
        </header>

        <AnimatePresence mode="wait">
          {state === "terms" && (
            <motion.div
              key="terms"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex-1 flex flex-col justify-center gap-8"
            >
              <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl space-y-6">
                <div className="w-12 h-12 bg-orange-500/10 rounded-2xl flex items-center justify-center border border-orange-500/20">
                  <Shield className="w-6 h-6 text-orange-500" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold">Terms of Service</h2>
                  <p className="text-zinc-500 text-sm leading-relaxed">
                    Please review our usage policy before entering the secure tunnel.
                  </p>
                </div>
                
                <div className="space-y-4 text-sm text-zinc-400 leading-relaxed">
                  <p>
                    <span className="text-white font-bold">Legal Use Only:</span> This application must only be used for lawful purposes. Any illegal activity is strictly prohibited.
                  </p>
                  <p>
                    <span className="text-white font-bold">Zero Knowledge:</span> We do not host, store, or see any of your content. All messages are end-to-end encrypted locally on your device.
                  </p>
                  <p>
                    <span className="text-white font-bold">Responsibility:</span> You are solely responsible for the content you share and the connections you make.
                  </p>
                </div>

                <button
                  onClick={handleAcceptTerms}
                  className="w-full py-4 bg-orange-500 text-black font-bold rounded-2xl hover:bg-orange-400 transition-colors"
                >
                  I Understand & Accept
                </button>
              </div>
            </motion.div>
          )}

          {state === "landing" && (
            <motion.div
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col justify-center gap-6"
            >
              <div className="space-y-4 mb-8">
                <h2 className="text-4xl font-bold leading-tight">
                  Private conversations, <span className="text-orange-500">untraceable</span>.
                </h2>
                <p className="text-zinc-400 text-lg">
                  No accounts. No logs. Just end-to-end encrypted messaging for the paranoid.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <button
                  onClick={handleHost}
                  className="group relative flex items-center justify-between p-6 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-orange-500/50 transition-all duration-300 overflow-hidden"
                >
                  <div className="relative z-10 text-left">
                    <div className="text-xl font-bold">Host a Room</div>
                    <div className="text-sm text-zinc-500 mt-1">Generate a code for someone to join.</div>
                  </div>
                  <Users className="w-8 h-8 text-zinc-700 group-hover:text-orange-500 transition-colors" />
                  <div className="absolute inset-0 bg-gradient-to-r from-orange-500/0 to-orange-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>

                <button
                  onClick={() => setState("joining")}
                  className="group relative flex items-center justify-between p-6 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-orange-500/50 transition-all duration-300 overflow-hidden"
                >
                  <div className="relative z-10 text-left">
                    <div className="text-xl font-bold">Join a Room</div>
                    <div className="text-sm text-zinc-500 mt-1">Enter a 6-digit code to connect.</div>
                  </div>
                  <Key className="w-8 h-8 text-zinc-700 group-hover:text-orange-500 transition-colors" />
                  <div className="absolute inset-0 bg-gradient-to-r from-orange-500/0 to-orange-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </div>
            </motion.div>
          )}

          {state === "hosting" && (
            <motion.div
              key="hosting"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex-1 flex flex-col items-center justify-center text-center gap-8"
            >
              <div className="space-y-2">
                <div className="text-sm font-bold text-orange-500 uppercase tracking-widest">Waiting for participant</div>
                <h2 className="text-2xl font-bold">Share this code</h2>
              </div>

              <div className="relative group">
                <div className="text-6xl font-mono font-black tracking-[0.2em] text-white bg-zinc-900/50 px-8 py-6 rounded-3xl border-2 border-zinc-800 group-hover:border-orange-500 transition-colors">
                  {roomCode}
                </div>
                <button
                  onClick={copyCode}
                  className="absolute -right-4 -top-4 w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center text-black hover:scale-110 active:scale-95 transition-transform shadow-xl shadow-orange-500/20"
                >
                  {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>

              <p className="text-zinc-500 max-w-xs">
                Once someone joins with this code, a secure encrypted channel will be established.
              </p>

              <button
                onClick={() => setState("landing")}
                className="flex items-center gap-2 text-zinc-500 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Cancel hosting</span>
              </button>
            </motion.div>
          )}

          {state === "joining" && (
            <motion.div
              key="joining"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 flex flex-col justify-center gap-8"
            >
              <div className="space-y-2">
                <button
                  onClick={() => setState("landing")}
                  className="flex items-center gap-2 text-zinc-500 hover:text-white transition-colors mb-4"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <h2 className="text-3xl font-bold">Enter room code</h2>
                <p className="text-zinc-500">Enter the 6-digit code provided by the host.</p>
              </div>

              <div className="space-y-6">
                <input
                  type="text"
                  maxLength={6}
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="w-full text-center text-5xl font-mono font-black tracking-[0.2em] bg-zinc-900 border-2 border-zinc-800 rounded-3xl py-6 focus:border-orange-500 focus:outline-none transition-colors placeholder:text-zinc-800"
                />
                
                <button
                  onClick={handleJoin}
                  disabled={inputCode.length !== 6}
                  className="w-full py-4 bg-orange-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold rounded-2xl hover:bg-orange-400 transition-colors flex items-center justify-center gap-2"
                >
                  <span>Connect Securely</span>
                  <Lock className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {state === "chatting" && (
            <motion.div
              key="chatting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`flex-1 flex flex-col h-full transition-all duration-500 ${!isWindowFocused ? "blur-xl grayscale pointer-events-none scale-[0.98]" : ""}`}
            >
              {/* Privacy Shield Overlay */}
              {!isWindowFocused && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mb-4 border border-orange-500/30">
                    <EyeOff className="w-8 h-8 text-orange-500" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Privacy Shield Active</h3>
                  <p className="text-zinc-500 text-sm">Click anywhere to resume your secure session.</p>
                </div>
              )}

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto py-4 space-y-4 custom-scrollbar">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-30">
                    <MessageSquare className="w-12 h-12 mb-4" />
                    <p className="text-sm font-medium">Secure channel established.<br />Messages self-destruct in 5m.</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"}`}
                    >
                      <div className="flex flex-col gap-1">
                        <div
                          className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                            msg.sender === "me"
                              ? "bg-orange-500 text-black font-medium rounded-tr-none ml-auto"
                              : "bg-zinc-800 text-zinc-100 rounded-tl-none mr-auto"
                          }`}
                        >
                          {msg.text}
                        </div>
                        <div className={`flex items-center gap-1 text-[9px] text-zinc-600 ${msg.sender === "me" ? "justify-end" : "justify-start"}`}>
                          <Timer className="w-2.5 h-2.5" />
                          <span>{Math.max(0, Math.ceil((selfDestructTime - (Date.now() - msg.timestamp)) / 1000))}s</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="pt-4 pb-2">
                {!isPeerConnected && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-500 text-xs font-bold uppercase tracking-wider">
                    <AlertCircle className="w-4 h-4" />
                    <span>Peer disconnected</span>
                  </div>
                )}
                <form onSubmit={handleSendMessage} className="relative">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={isEncrypted ? "Type an encrypted message..." : "Establishing secure link..."}
                    disabled={!isEncrypted}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-5 pr-14 focus:border-orange-500 focus:outline-none transition-colors disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim() || !isEncrypted}
                    className="absolute right-2 top-2 bottom-2 w-12 bg-orange-500 disabled:bg-zinc-800 text-black rounded-xl flex items-center justify-center hover:bg-orange-400 transition-colors"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Toast */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed bottom-8 left-4 right-4 z-50 p-4 bg-red-500 text-white rounded-2xl flex items-center gap-3 shadow-2xl shadow-red-500/20"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="font-bold text-sm">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Support Link */}
      <div className="fixed bottom-6 right-6 z-50 group">
        <div className="absolute bottom-full right-0 mb-4 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all duration-300 translate-y-2 group-hover:translate-y-0">
          <div className="bg-white p-3 rounded-2xl shadow-2xl border border-zinc-200">
            <QRCode 
              value="https://buymeacoffee.com/vibecreator" 
              size={120}
              level="H"
            />
            <div className="mt-2 text-center">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Scan to Support</span>
            </div>
          </div>
        </div>
        
        <motion.a
          href="https://buymeacoffee.com/vibecreator"
          target="_blank"
          rel="noopener noreferrer"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.05 }}
          className="flex items-center gap-3 px-4 py-2 bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-full hover:border-orange-500/50 transition-all shadow-2xl shadow-black"
        >
          <div className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-black shadow-lg shadow-yellow-400/20">
            <Coffee className="w-4 h-4" />
          </div>
          <div className="flex flex-col pr-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 group-hover:text-orange-500 transition-colors">Support this</span>
            <span className="text-xs font-bold">Secure Tunnel</span>
          </div>
          <QrCode className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
        </motion.a>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}} />
    </div>
  );
}
