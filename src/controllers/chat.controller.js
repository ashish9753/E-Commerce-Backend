import Chat from "../models/chat.model.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const sendMessage = async (req, res, next) => {
  try {
    const { receiverId, message, messageType = "TEXT", fileUrl } = req.body;
    if (!receiverId || !message) throw new ApiError(400, "receiverId and message required");
    if (receiverId === req.user._id.toString()) throw new ApiError(400, "Cannot message yourself");

    const chat = await Chat.create({
      sender: req.user._id,
      receiver: receiverId,
      message,
      messageType,
      fileUrl,
    });

    await chat.populate("sender", "name profileImage");
    res.status(201).json(new ApiResponse(201, { chat }, "Message sent"));
  } catch (err) {
    next(err);
  }
};

export const getConversation = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { page, limit, skip } = getPaginationData(req.query);

    const filter = {
      isDeleted: false,
      $or: [
        { sender: req.user._id, receiver: userId },
        { sender: userId, receiver: req.user._id },
      ],
    };

    const [messages, total] = await Promise.all([
      Chat.find(filter)
        .populate("sender", "name profileImage")
        .populate("receiver", "name profileImage")
        .skip(skip).limit(limit).sort({ createdAt: -1 }),
      Chat.countDocuments(filter),
    ]);

    // Mark received messages as seen
    await Chat.updateMany(
      { sender: userId, receiver: req.user._id, isSeen: false },
      { isSeen: true, seenAt: new Date() }
    );

    res.json(new ApiResponse(200, buildPaginatedResponse(messages.reverse(), total, page, limit)));
  } catch (err) {
    next(err);
  }
};

export const getConversationList = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const conversations = await Chat.aggregate([
      { $match: { $or: [{ sender: userId }, { receiver: userId }], isDeleted: false } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: [{ $eq: ["$sender", userId] }, "$receiver", "$sender"],
          },
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [{ $and: [{ $eq: ["$receiver", userId] }, { $eq: ["$isSeen", false] }] }, 1, 0],
            },
          },
        },
      },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "participant" } },
      { $unwind: "$participant" },
      {
        $project: {
          participant: { _id: 1, name: 1, profileImage: 1 },
          lastMessage: { message: 1, createdAt: 1, isSeen: 1, sender: 1 },
          unreadCount: 1,
        },
      },
      { $sort: { "lastMessage.createdAt": -1 } },
    ]);

    res.json(new ApiResponse(200, { conversations }));
  } catch (err) {
    next(err);
  }
};

export const deleteMessage = async (req, res, next) => {
  try {
    const message = await Chat.findOneAndUpdate(
      { _id: req.params.messageId, sender: req.user._id },
      { isDeleted: true },
      { new: true }
    );
    if (!message) throw new ApiError(404, "Message not found");
    res.json(new ApiResponse(200, null, "Message deleted"));
  } catch (err) {
    next(err);
  }
};
