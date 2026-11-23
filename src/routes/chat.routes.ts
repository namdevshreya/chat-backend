import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, idSchema, messageIdSchema, parse, textSchema } from '../lib/http';
import { createOrGetDirectChat, getChatDetails } from '../services/chat.service';
import {
  deleteMessage,
  editMessage,
  getLastSeen,
  getMessages,
  markMessageRead,
  sendMessage,
  updateLastSeen,
} from '../services/message.service';

export const chatRouter = Router();

// 1. Create or get 1:1 chat
chatRouter.post(
  '/chat/create',
  asyncHandler(async (req, res) => {
    const { userAId, userBId } = parse(z.object({ userAId: idSchema, userBId: idSchema }), req.body);
    const { chatId, created } = await createOrGetDirectChat(userAId, userBId);
    res.status(created ? 201 : 200).json({ chatId, created });
  }),
);

chatRouter.get(
  '/chat/:chatId',
  asyncHandler(async (req, res) => {
    const { chatId } = parse(z.object({ chatId: idSchema }), req.params);
    res.json(await getChatDetails(chatId));
  }),
);

// 2. Send message
chatRouter.post(
  '/chat/:chatId/message/send',
  asyncHandler(async (req, res) => {
    const { chatId } = parse(z.object({ chatId: idSchema }), req.params);
    const { senderId, text } = parse(z.object({ senderId: idSchema, text: textSchema }), req.body);
    const message = await sendMessage(chatId, senderId, text);
    res.status(201).json(message);
  }),
);

// 3. Get messages (optional: userId to enforce membership, before=<messageId> for older pages)
chatRouter.get(
  '/chat/:chatId/messages',
  asyncHandler(async (req, res) => {
    const { chatId } = parse(z.object({ chatId: idSchema }), req.params);
    const { limit, userId, before } = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        userId: idSchema.optional(),
        before: messageIdSchema.optional(),
      }),
      req.query,
    );
    const opts: { userId?: number; before?: string } = {};
    if (userId !== undefined) opts.userId = userId;
    if (before !== undefined) opts.before = before;
    res.json(await getMessages(chatId, limit, opts));
  }),
);

// 4. Mark message read
chatRouter.post(
  '/chat/:chatId/message/:messageId/read',
  asyncHandler(async (req, res) => {
    const { chatId, messageId } = parse(
      z.object({ chatId: idSchema, messageId: messageIdSchema }),
      req.params,
    );
    const { userId } = parse(z.object({ userId: idSchema }), req.body);
    res.json(await markMessageRead(chatId, messageId, userId));
  }),
);

// 5. Update last seen message
chatRouter.post(
  '/chat/:chatId/lastseen',
  asyncHandler(async (req, res) => {
    const { chatId } = parse(z.object({ chatId: idSchema }), req.params);
    const { userId, messageId } = parse(
      z.object({ userId: idSchema, messageId: messageIdSchema }),
      req.body,
    );
    res.json(await updateLastSeen(chatId, userId, messageId));
  }),
);

chatRouter.get(
  '/chat/:chatId/lastseen',
  asyncHandler(async (req, res) => {
    const { chatId } = parse(z.object({ chatId: idSchema }), req.params);
    res.json({ chatId, lastSeen: await getLastSeen(chatId) });
  }),
);

// Bonus: edit message
chatRouter.patch(
  '/chat/:chatId/message/:messageId',
  asyncHandler(async (req, res) => {
    const { chatId, messageId } = parse(
      z.object({ chatId: idSchema, messageId: messageIdSchema }),
      req.params,
    );
    const { senderId, text } = parse(z.object({ senderId: idSchema, text: textSchema }), req.body);
    res.json(await editMessage(chatId, messageId, senderId, text));
  }),
);

// Bonus: delete message (soft delete)
chatRouter.delete(
  '/chat/:chatId/message/:messageId',
  asyncHandler(async (req, res) => {
    const { chatId, messageId } = parse(
      z.object({ chatId: idSchema, messageId: messageIdSchema }),
      req.params,
    );
    const { senderId } = parse(z.object({ senderId: idSchema }), req.body);
    res.json(await deleteMessage(chatId, messageId, senderId));
  }),
);
