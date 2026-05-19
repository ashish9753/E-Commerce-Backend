import Event from "../models/event.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const createEvent = async (req, res, next) => {
  try {
    const { name, badge, description, discountPercent, startDate, endDate } = req.body;
    if (!name || !startDate || !endDate) throw new ApiError(400, "Name, startDate and endDate are required");

    let image;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "ecommerce/events");
      image = result.secure_url;
    }

    const event = await Event.create({ name, badge, description, discountPercent, startDate, endDate, image });
    res.status(201).json(new ApiResponse(201, { event }, "Event created"));
  } catch (err) { next(err); }
};

export const getAllEvents = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.active === "true") filter.isActive = true;
    const events = await Event.find(filter).sort({ startDate: -1 });
    res.json(new ApiResponse(200, { events }));
  } catch (err) { next(err); }
};

export const updateEvent = async (req, res, next) => {
  try {
    const { name, badge, description, discountPercent, startDate, endDate, isActive } = req.body;
    const updates = { name, badge, description, discountPercent, startDate, endDate, isActive };
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "ecommerce/events");
      updates.image = result.secure_url;
    }
    const event = await Event.findByIdAndUpdate(req.params.eventId, updates, { new: true });
    if (!event) throw new ApiError(404, "Event not found");
    res.json(new ApiResponse(200, { event }, "Event updated"));
  } catch (err) { next(err); }
};

export const deleteEvent = async (req, res, next) => {
  try {
    await Event.findByIdAndDelete(req.params.eventId);
    res.json(new ApiResponse(200, null, "Event deleted"));
  } catch (err) { next(err); }
};
