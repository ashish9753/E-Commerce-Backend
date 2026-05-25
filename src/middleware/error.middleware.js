import ApiError from "../utils/ApiError.js";

export const notFound = (req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
};

export const errorHandler = (err, req, res, next) => {
  let error = err;

  if (!(error instanceof ApiError)) {
    let statusCode = error.statusCode || 500;
    let message = error.message || "Internal Server Error";

    if (error.name === "MulterError") {
      statusCode = 400;
      const multerMessages = {
        LIMIT_FILE_SIZE: "File is too large",
        LIMIT_FILE_COUNT: "Too many files uploaded",
        LIMIT_UNEXPECTED_FILE: "Unexpected file field",
      };
      message = multerMessages[error.code] || error.message;
    } else if (error.name === "CastError") {
      statusCode = 400;
      message = `Invalid ${error.path}: ${error.value}`;
    } else if (error.code === 11000) {
      statusCode = 409;
      const field = Object.keys(error.keyValue)[0];
      const value = Object.values(error.keyValue)[0];
      const fieldLabel = field.charAt(0).toUpperCase() + field.slice(1);
      message = `"${value}" already exists. Please use a different ${fieldLabel}.`;
    } else if (error.name === "ValidationError") {
      statusCode = 400;
      message = Object.values(error.errors).map((e) => e.message).join(", ");
    }

    error = new ApiError(statusCode, message, [], process.env.NODE_ENV === "development" ? err.stack : "");
  }

  return res.status(error.statusCode).json({
    success: false,
    message: error.message,
    errors: error.errors,
    ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
  });
};
