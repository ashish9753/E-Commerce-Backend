import SupportTicket from "../models/supportTicket.model.js";
import Order from "../models/order.model.js";
import { notify, notifyAdmins } from "../utils/notify.js";
import { pushToUser } from "../utils/sseClients.js";
import User from "../models/user.model.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

/* ── User: create ticket ── */
export const createTicket = async (req, res, next) => {
  try {
    const { orderId, subject, message } = req.body;
    if (!subject || !message) throw new ApiError(400, "subject and message are required");

    // Validate order ownership if provided
    if (orderId) {
      const order = await Order.findOne({ _id: orderId, user: req.user._id });
      if (!order) throw new ApiError(404, "Order not found");
    }

    const ticket = await SupportTicket.create({
      user:    req.user._id,
      order:   orderId || undefined,
      subject,
      messages: [{ sender: req.user._id, senderRole: "user", text: message }],
    });

    await ticket.populate("user", "name email");
    if (ticket.order) await ticket.populate("order", "orderNumber totalPrice");

    // Notify user: ticket opened confirmation with ticket number
    await notify({
      userId:  req.user._id,
      title:   "Support Ticket Opened 🎫",
      message: `Your support ticket #${ticket._id.toString().slice(-8).toUpperCase()} has been opened. Our team will get back to you shortly.`,
      type:    "SYSTEM",
      link:    `/support`,
    });

    // Notify admins
    await notifyAdmins({
      title:   "New Support Ticket 🎫",
      message: `${req.user.name} opened a support ticket: "${subject}"`,
      type:    "SYSTEM",
      link:    "/admin",
    });

    res.status(201).json(new ApiResponse(201, { ticket }, "Support ticket created"));
  } catch (err) { next(err); }
};

/* ── User: my tickets ── */
export const getMyTickets = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = { user: req.user._id };
    if (req.query.status) filter.status = req.query.status;

    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .populate("order", "orderNumber totalPrice createdAt")
        .select("-messages")
        .sort({ updatedAt: -1 }).skip(skip).limit(limit),
      SupportTicket.countDocuments(filter),
    ]);

    res.json(new ApiResponse(200, buildPaginatedResponse(tickets, total, page, limit)));
  } catch (err) { next(err); }
};

/* ── Shared: get single ticket with messages ── */
export const getTicketById = async (req, res, next) => {
  try {
    const ticket = await SupportTicket.findById(req.params.ticketId)
      .populate("user", "name email")
      .populate("order", "orderNumber totalPrice orderItems createdAt")
      .populate("messages.sender", "name role");

    if (!ticket) throw new ApiError(404, "Ticket not found");

    const isOwner = ticket.user._id.toString() === req.user._id.toString();
    const isStaff = req.user.role === "admin" || req.user.role === "employee";
    if (!isOwner && !isStaff) throw new ApiError(403, "Access denied");

    res.json(new ApiResponse(200, { ticket }));
  } catch (err) { next(err); }
};

/* ── Shared: reply to ticket ── */
export const replyToTicket = async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) throw new ApiError(400, "message is required");

    const ticket = await SupportTicket.findById(req.params.ticketId);
    if (!ticket) throw new ApiError(404, "Ticket not found");

    const isOwner = ticket.user.toString() === req.user._id.toString();
    const isStaff = req.user.role === "admin" || req.user.role === "employee";
    if (!isOwner && !isStaff) throw new ApiError(403, "Access denied");

    if (["RESOLVED", "CLOSED"].includes(ticket.status)) {
      throw new ApiError(400, "Cannot reply to a resolved or closed ticket");
    }

    // Customers must wait for at least one staff reply before sending more messages
    if (!isStaff) {
      const hasStaffReply = ticket.messages.some(m => m.senderRole === "admin" || m.senderRole === "employee");
      if (!hasStaffReply) {
        throw new ApiError(403, "Please wait for our support team to respond before sending another message.");
      }
    }

    // Staff messages render the same way to the customer ("admin" senderRole)
    // — keeps the customer experience consistent regardless of who answers.
    ticket.messages.push({
      sender:     req.user._id,
      senderRole: isStaff ? "admin" : "user",
      text:       message.trim(),
    });

    // Auto-advance status when a staff member first replies
    if (isStaff && ticket.status === "OPEN") {
      ticket.status = "IN_PROGRESS";
      ticket.assignedAdmin = req.user._id;
    }

    await ticket.save();
    await ticket.populate("messages.sender", "name role");

    const newMessage = ticket.messages[ticket.messages.length - 1];

    // Push the new message directly via SSE so the recipient's chat updates with zero extra API calls
    const msgPayload = {
      type:     "support_message",
      ticketId: ticket._id.toString(),
      status:   ticket.status,
      message:  newMessage,
    };

    if (isStaff) {
      // Push chat message to user via SSE — no DB notification for replies
      pushToUser(ticket.user.toString(), msgPayload);
    } else {
      // Push chat message to all staff (admins + employees) via SSE
      const staff = await User.find({ role: { $in: ["admin", "employee"] } }).select("_id");
      staff.forEach(s => pushToUser(s._id.toString(), msgPayload));
      // DB notification for admin bell (admins are the primary support owners)
      await notifyAdmins({
        title:   "New Support Reply 💬",
        message: `Customer replied on ticket: "${ticket.subject}"`,
        type:    "SYSTEM",
        link:    "/admin",
      });
    }

    res.json(new ApiResponse(200, { message: newMessage, ticket }, "Reply sent"));
  } catch (err) { next(err); }
};

/* ── Admin: all tickets ── */
export const getAllTickets = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .populate("user", "name email")
        .populate("order", "orderNumber totalPrice")
        .select("-messages")
        .sort({ updatedAt: -1 }).skip(skip).limit(limit),
      SupportTicket.countDocuments(filter),
    ]);

    res.json(new ApiResponse(200, buildPaginatedResponse(tickets, total, page, limit)));
  } catch (err) { next(err); }
};

/* ── Admin: update ticket status ── */
export const updateTicketStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const valid = ["OPEN","IN_PROGRESS","RESOLVED","CLOSED"];
    if (!valid.includes(status)) throw new ApiError(400, "Invalid status");

    const ticket = await SupportTicket.findById(req.params.ticketId);
    if (!ticket) throw new ApiError(404, "Ticket not found");

    ticket.status = status;
    if (status === "RESOLVED" || status === "CLOSED") ticket.resolvedAt = new Date();
    await ticket.save();

    // Only notify user when ticket is closed or resolved — no intermediate status noise
    if (status === "RESOLVED" || status === "CLOSED") {
      const label = status === "RESOLVED" ? "Resolved ✅" : "Closed";
      await notify({
        userId:  ticket.user,
        title:   `Ticket #${ticket._id.toString().slice(-8).toUpperCase()} ${label}`,
        message: status === "RESOLVED"
          ? `Your support ticket "${ticket.subject}" has been resolved. We hope your issue is sorted!`
          : `Your support ticket "${ticket.subject}" has been closed.`,
        type:    "SYSTEM",
        link:    `/support`,
      });
    }

    res.json(new ApiResponse(200, { ticket }, "Status updated"));
  } catch (err) { next(err); }
};
