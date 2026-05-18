import { verifyAccessToken } from "../utils/jwt.utils.js";
import Chat from "../models/chat.model.js";

const onlineUsers = new Map();

export const initChatSocket = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required"));
    try {
      const decoded = verifyAccessToken(token);
      socket.userId = decoded._id;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;
    onlineUsers.set(userId, socket.id);

    // Notify contacts that this user is online
    socket.broadcast.emit("user:online", { userId });

    socket.on("message:send", async ({ receiverId, message, messageType = "TEXT", fileUrl }) => {
      try {
        const chat = await Chat.create({
          sender: userId,
          receiver: receiverId,
          message,
          messageType,
          fileUrl,
        });

        await chat.populate("sender", "name profileImage");

        // Send to receiver if online
        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("message:receive", chat);
        }

        // Confirm delivery to sender
        socket.emit("message:sent", chat);
      } catch (err) {
        socket.emit("message:error", { message: err.message });
      }
    });

    socket.on("message:seen", async ({ senderId }) => {
      await Chat.updateMany(
        { sender: senderId, receiver: userId, isSeen: false },
        { isSeen: true, seenAt: new Date() }
      );

      const senderSocketId = onlineUsers.get(senderId);
      if (senderSocketId) {
        io.to(senderSocketId).emit("message:seen", { by: userId });
      }
    });

    socket.on("typing:start", ({ receiverId }) => {
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("typing:start", { userId });
      }
    });

    socket.on("typing:stop", ({ receiverId }) => {
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("typing:stop", { userId });
      }
    });

    socket.on("disconnect", () => {
      onlineUsers.delete(userId);
      socket.broadcast.emit("user:offline", { userId });
    });
  });
};

export const getOnlineUsers = () => [...onlineUsers.keys()];
