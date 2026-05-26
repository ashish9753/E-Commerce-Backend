import Attribute from "../models/attribute.model.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const createAttribute = async (req, res, next) => {
  try {
    const { name, unit, subcategory, options } = req.body;
    if (!name || !subcategory) throw new ApiError(400, "Name and subcategory are required");
    const parsedOptions = Array.isArray(options) ? options : (options || "").split(",").map(s => s.trim()).filter(Boolean);
    const attribute = await Attribute.create({ name, unit, subcategory, options: parsedOptions });
    await attribute.populate("subcategory", "name");
    res.status(201).json(new ApiResponse(201, { attribute }, "Attribute created"));
  } catch (err) { next(err); }
};

export const getAttributes = async (req, res, next) => {
  try {
    const filter = { isActive: true };
    if (req.query.subcategory) filter.subcategory = req.query.subcategory;
    const attributes = await Attribute.find(filter).populate("subcategory", "name").sort({ name: 1 });
    res.json(new ApiResponse(200, { attributes }));
  } catch (err) { next(err); }
};

export const updateAttribute = async (req, res, next) => {
  try {
    const { name, unit, subcategory, options, isActive } = req.body;
    const updates = { name, unit, isActive };
    if (subcategory) updates.subcategory = subcategory;
    if (options !== undefined) {
      updates.options = Array.isArray(options) ? options : options.split(",").map(s => s.trim()).filter(Boolean);
    }
    const attribute = await Attribute.findByIdAndUpdate(req.params.attributeId, updates, { new: true }).populate("subcategory", "name");
    if (!attribute) throw new ApiError(404, "Attribute not found");
    res.json(new ApiResponse(200, { attribute }, "Attribute updated"));
  } catch (err) { next(err); }
};

export const deleteAttribute = async (req, res, next) => {
  try {
    await Attribute.findByIdAndUpdate(req.params.attributeId, { isActive: false });
    res.json(new ApiResponse(200, null, "Attribute deactivated"));
  } catch (err) { next(err); }
};
