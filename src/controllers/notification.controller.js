import Notification from "../models/notification.model.js";
import User from "../models/user.model.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { addClient, removeClient, pushToUser } from "../utils/sseClients.js";
import { verifyAccessToken } from "../utils/jwt.utils.js";

// SSE: client connects and keeps connection open to receive push events
export const streamNotifications = async (req, res) => {
  try {
    // EventSource can't send headers, so token comes as query param
    const token = req.query.token;
    if (!token) return res.status(401).end();
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded._id).select("_id isBlocked");
    if (!user || user.isBlocked) return res.status(401).end();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
    res.flushHeaders();

    // Send a comment every 25s to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      try { res.write(":heartbeat\n\n"); } catch { clearInterval(heartbeat); }
    }, 25_000);

    const userId = user._id.toString();
    addClient(userId, res);

    req.on("close", () => {
      clearInterval(heartbeat);
      removeClient(userId, res);
    });
  } catch {
    res.status(401).end();
  }
};

export const getMyNotifications = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = { user: req.user._id };
    if (req.query.isRead !== undefined) filter.isRead = req.query.isRead === "true";

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.user._id, isRead: false }),
    ]);

    res.json(new ApiResponse(200, { ...buildPaginatedResponse(notifications, total, page, limit), unreadCount }));
  } catch (err) {
    next(err);
  }
};

export const markAsRead = async (req, res, next) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, user: req.user._id },
      { isRead: true }
    );
    res.json(new ApiResponse(200, null, "Marked as read"));
  } catch (err) {
    next(err);
  }
};

export const markAllAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
    res.json(new ApiResponse(200, null, "All notifications marked as read"));
  } catch (err) {
    next(err);
  }
};

export const deleteNotification = async (req, res, next) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.notificationId, user: req.user._id });
    res.json(new ApiResponse(200, null, "Notification deleted"));
  } catch (err) {
    next(err);
  }
};

export const sendBroadcastNotification = async (req, res, next) => {
  try {
    const { userIds, targetRole, userEmail, title, message, type, link, couponCode } = req.body;
    if (!title || !message || !type) {
      throw new ApiError(400, "title, message, and type are required");
    }

    let recipientIds = [];

    if (userEmail) {
      // Personal: send to a specific user by email
      const found = await User.findOne({ email: userEmail.toLowerCase().trim() }).select("_id");
      if (!found) throw new ApiError(404, `No user found with email: ${userEmail}`);
      recipientIds = [found._id];
    } else if (targetRole && targetRole !== "specific") {
      const roleFilter = targetRole === "all" ? {} : { role: targetRole };
      const users = await User.find(roleFilter).select("_id");
      recipientIds = users.map((u) => u._id);
    } else if (userIds?.length) {
      recipientIds = userIds;
    } else {
      throw new ApiError(400, "Provide targetRole, userEmail, or userIds");
    }

    if (!recipientIds.length) {
      return res.json(new ApiResponse(200, { count: 0 }, "No recipients found"));
    }

    const docs = recipientIds.map((userId) => ({
      user: userId, title, message, type,
      ...(link       && { link }),
      ...(couponCode && { couponCode: couponCode.toUpperCase() }),
    }));
    const created = await Notification.insertMany(docs);

    // Push in real-time to any connected SSE clients
    for (const notif of created) {
      pushToUser(notif.user.toString(), { type: "notification", notification: notif });
    }

    res.json(new ApiResponse(200, { count: recipientIds.length }, `Notification sent to ${recipientIds.length} user${recipientIds.length !== 1 ? "s" : ""}`));
  } catch (err) {
    next(err);
  }
};
