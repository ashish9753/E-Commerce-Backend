import { Router } from "express";
import {
  sendMessage, getConversation, getConversationList, deleteMessage,
} from "../controllers/chat.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.use(protect);

router.get("/conversations", getConversationList);
router.get("/conversations/:userId", getConversation);
router.post("/", sendMessage);
router.delete("/:messageId", deleteMessage);

export default router;
