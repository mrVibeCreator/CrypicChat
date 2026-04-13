import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const PORT = 3000;

  // Strict CSP and Security Headers
  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' ws: wss:;"
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    next();
  });

  // Track active rooms and their participants
  const rooms = new Map<string, Set<string>>();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("create-room", () => {
      let code: string;
      do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
      } while (rooms.has(code));

      rooms.set(code, new Set([socket.id]));
      socket.join(code);
      socket.emit("room-created", code);
      console.log(`Room created: ${code} by ${socket.id}`);
    });

    socket.on("join-room", (code: string) => {
      const room = rooms.get(code);
      if (room) {
        if (room.size < 2) {
          room.add(socket.id);
          socket.join(code);
          socket.emit("room-joined", code);
          
          // Notify both that they are ready for key exchange
          io.to(code).emit("peer-joined", socket.id);
          console.log(`User ${socket.id} joined room ${code}`);
        } else {
          socket.emit("error", "Room is full");
        }
      } else {
        socket.emit("error", "Invalid room code");
      }
    });

    // Relay public keys for ECDH
    socket.on("send-public-key", ({ code, publicKey }: { code: string; publicKey: any }) => {
      socket.to(code).emit("receive-public-key", { publicKey, from: socket.id });
    });

    // Relay encrypted messages
    socket.on("send-message", ({ code, encryptedData, iv }: { code: string; encryptedData: any; iv: any }) => {
      socket.to(code).emit("receive-message", { encryptedData, iv });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      // Clean up rooms
      rooms.forEach((participants, code) => {
        if (participants.has(socket.id)) {
          participants.delete(socket.id);
          if (participants.size === 0) {
            rooms.delete(code);
            console.log(`Room ${code} deleted`);
          } else {
            io.to(code).emit("peer-left");
          }
        }
      });
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
