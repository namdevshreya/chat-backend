import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, idSchema, parse } from '../lib/http';
import { listUserChats } from '../services/chat.service';

export const userRouter = Router();

// Helper (not part of the required list): create users so the chat APIs can be tested.
userRouter.post(
  '/users',
  asyncHandler(async (req, res) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(100) }), req.body);
    const user = await prisma.user.create({ data: { name } });
    res.status(201).json(user);
  }),
);

userRouter.get(
  '/users',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.user.findMany({ orderBy: { id: 'asc' } }));
  }),
);

// 6. List user chats
userRouter.get(
  '/user/:userId/chats',
  asyncHandler(async (req, res) => {
    const { userId } = parse(z.object({ userId: idSchema }), req.params);
    const chats = await listUserChats(userId);
    res.json({ userId, chats });
  }),
);
