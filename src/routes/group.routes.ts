import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, idSchema, parse } from '../lib/http';
import {
  addGroupMembers,
  createGroup,
  removeGroupMember,
  renameGroup,
} from '../services/chat.service';

export const groupRouter = Router();

const groupName = z.string().trim().min(1).max(100);

// Create a group. The creator becomes ADMIN.
groupRouter.post(
  '/group/create',
  asyncHandler(async (req, res) => {
    const { name, creatorId, memberIds } = parse(
      z.object({ name: groupName, creatorId: idSchema, memberIds: z.array(idSchema).min(1).max(200) }),
      req.body,
    );
    res.status(201).json(await createGroup(name, creatorId, memberIds));
  }),
);

// Rename (admin only)
groupRouter.patch(
  '/group/:chatId',
  asyncHandler(async (req, res) => {
    const { chatId } = parse(z.object({ chatId: idSchema }), req.params);
    const { requesterId, name } = parse(z.object({ requesterId: idSchema, name: groupName }), req.body);
    await renameGroup(chatId, requesterId, name);
    res.json({ chatId, name });
  }),
);

// Add members (admin only)
groupRouter.post(
  '/group/:chatId/members',
  asyncHandler(async (req, res) => {
    const { chatId } = parse(z.object({ chatId: idSchema }), req.params);
    const { requesterId, userIds } = parse(
      z.object({ requesterId: idSchema, userIds: z.array(idSchema).min(1).max(200) }),
      req.body,
    );
    res.json({ chatId, memberIds: await addGroupMembers(chatId, requesterId, userIds) });
  }),
);

// Remove a member (admin) or leave the group (self)
groupRouter.delete(
  '/group/:chatId/members/:userId',
  asyncHandler(async (req, res) => {
    const { chatId, userId } = parse(z.object({ chatId: idSchema, userId: idSchema }), req.params);
    const { requesterId } = parse(z.object({ requesterId: idSchema }), req.body);
    res.json({ chatId, memberIds: await removeGroupMember(chatId, requesterId, userId) });
  }),
);
