import Notification from "../models/notification.model.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

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
    const { userIds, title, message, type, link } = req.body;
    if (!userIds?.length || !title || !message || !type) {
      throw new ApiError(400, "userIds, title, message, and type are required");
    }

    const notifications = userIds.map((userId) => ({ user: userId, title, message, type, link }));
    await Notification.insertMany(notifications);

    res.json(new ApiResponse(200, null, `Notification sent to ${userIds.length} users`));
  } catch (err) {
    next(err);
  }
};
