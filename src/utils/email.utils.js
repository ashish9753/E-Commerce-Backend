import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendEmail = async ({ to, subject, html }) => {
  if (!process.env.SMTP_HOST || process.env.SMTP_HOST === 'smtp.example.com') return;
  try {
    await transporter.sendMail({
      from: `"E-Commerce" <${process.env.SMTP_FROM}>`,
      to,
      subject,
      html,
    });
  } catch {
    // Non-fatal in dev — SMTP not configured
  }
};

export const orderConfirmationEmail = (order, user) => ({
  to: user.email,
  subject: `Order Confirmed - ${order.orderNumber}`,
  html: `
    <h2>Hi ${user.name}, your order is confirmed!</h2>
    <p>Order Number: <strong>${order.orderNumber}</strong></p>
    <p>Total Amount: <strong>₹${order.totalPrice}</strong></p>
    <p>Estimated Delivery: ${order.estimatedDeliveryDate ? new Date(order.estimatedDeliveryDate).toDateString() : "3-5 business days"}</p>
    <p>Thank you for shopping with us!</p>
  `,
});

export const passwordResetEmail = (name, resetUrl) => ({
  subject: "Reset Your Password",
  html: `
    <h2>Hi ${name},</h2>
    <p>You requested a password reset. Click the link below (valid for 15 minutes):</p>
    <a href="${resetUrl}" style="background:#2563eb;color:white;padding:10px 20px;border-radius:5px;text-decoration:none;">Reset Password</a>
    <p>If you did not request this, ignore this email.</p>
  `,
});
