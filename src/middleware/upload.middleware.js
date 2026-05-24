import multer from "multer";
import ApiError from "../utils/ApiError.js";

const storage = multer.memoryStorage();

const imageFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new ApiError(400, "Only JPEG, PNG, and WebP images are allowed"), false);
};

const evidenceFilter = (req, file, cb) => {
  const allowedImages = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const allowedVideos = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"];
  if (allowedImages.includes(file.mimetype) || allowedVideos.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, "Only images (JPEG, PNG, WebP) and videos (MP4, MOV, WebM) are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
});

const evidenceUpload = multer({
  storage,
  fileFilter: evidenceFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

export const uploadSingle   = (field)        => upload.single(field);
export const uploadMultiple = (field, max=5) => upload.array(field, max);
export const uploadFields   = (fields)       => upload.fields(fields);
export const uploadReturnEvidence = evidenceUpload.fields([
  { name: "photos", maxCount: 5 },
  { name: "video",  maxCount: 1 },
]);

// For admin/employee refund proof screenshots
export const uploadRefundProof = upload.array("refundProof", 5);

export default upload;
