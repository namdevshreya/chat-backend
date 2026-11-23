import { ChatType, MemberRole, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';

export interface ChatSummary {
  chatId: number;
  type: ChatType;
  name: string | null;
  memberIds: number[];
  createdAt: Date;
}

const directKeyFor = (a: number, b: number): string => `${Math.min(a, b)}_${Math.max(a, b)}`;

async function assertUsersExist(userIds: number[]): Promise<void> {
  const unique = [...new Set(userIds)];
  const found = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true } });
  if (found.length !== unique.length) {
    const foundIds = new Set(found.map((u) => u.id));
    const missing = unique.filter((id) => !foundIds.has(id));
    throw notFound(`User(s) not found: ${missing.join(', ')}`);
  }
}

/** Throws 404 if the chat does not exist, 403 if the user is not a member. Returns the member's role. */
export async function assertMember(chatId: number, userId: number): Promise<MemberRole> {
  const member = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { role: true },
  });
  if (member) return member.role;

  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { id: true } });
  if (!chat) throw notFound(`Chat ${chatId} not found`);
  throw forbidden(`User ${userId} is not a member of chat ${chatId}`);
}

export async function assertChatExists(chatId: number): Promise<void> {
  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { id: true } });
  if (!chat) throw notFound(`Chat ${chatId} not found`);
}

async function getGroupOrThrow(chatId: number) {
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) throw notFound(`Chat ${chatId} not found`);
  if (chat.type !== ChatType.GROUP) throw badRequest('This operation is only allowed on group chats');
  return chat;
}

async function assertAdmin(chatId: number, userId: number): Promise<void> {
  const role = await assertMember(chatId, userId);
  if (role !== MemberRole.ADMIN) throw forbidden('Only a group admin can do this');
}

// ---------- 1:1 chats ----------

export async function createOrGetDirectChat(
  userAId: number,
  userBId: number,
): Promise<{ chatId: number; created: boolean }> {
  if (userAId === userBId) throw badRequest('userAId and userBId must be different users');
  await assertUsersExist([userAId, userBId]);

  const directKey = directKeyFor(userAId, userBId);
  const existing = await prisma.chat.findUnique({ where: { directKey }, select: { id: true } });
  if (existing) return { chatId: existing.id, created: false };

  try {
    const chat = await prisma.chat.create({
      data: {
        type: ChatType.DIRECT,
        directKey,
        createdById: userAId,
        members: {
          create: [
            { userId: userAId, role: MemberRole.MEMBER },
            { userId: userBId, role: MemberRole.MEMBER },
          ],
        },
      },
      select: { id: true },
    });
    return { chatId: chat.id, created: true };
  } catch (err) {
    // Two simultaneous requests for the same pair: the unique key stops the duplicate, so fetch the winner.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await prisma.chat.findUnique({ where: { directKey }, select: { id: true } });
      if (winner) return { chatId: winner.id, created: false };
    }
    throw err;
  }
}

// ---------- list chats ----------

export async function listUserChats(userId: number): Promise<ChatSummary[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw notFound(`User ${userId} not found`);

  const chats = await prisma.chat.findMany({
    where: { members: { some: { userId } } },
    include: { members: { select: { userId: true }, orderBy: { joinedAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });

  return chats.map((c) => ({
    chatId: c.id,
    type: c.type,
    name: c.name,
    memberIds: c.members.map((m) => m.userId),
    createdAt: c.createdAt,
  }));
}

// ---------- bonus: group chats ----------

export async function createGroup(
  name: string,
  creatorId: number,
  memberIds: number[],
): Promise<{ chatId: number; memberIds: number[] }> {
  const allIds = [...new Set([creatorId, ...memberIds])];
  if (allIds.length < 2) throw badRequest('A group needs at least 2 members including the creator');
  await assertUsersExist(allIds);

  const chat = await prisma.chat.create({
    data: {
      type: ChatType.GROUP,
      name,
      createdById: creatorId,
      members: {
        create: allIds.map((userId) => ({
          userId,
          role: userId === creatorId ? MemberRole.ADMIN : MemberRole.MEMBER,
        })),
      },
    },
    select: { id: true },
  });
  return { chatId: chat.id, memberIds: allIds };
}

export async function renameGroup(chatId: number, requesterId: number, name: string): Promise<void> {
  await getGroupOrThrow(chatId);
  await assertAdmin(chatId, requesterId);
  await prisma.chat.update({ where: { id: chatId }, data: { name } });
}

export async function addGroupMembers(
  chatId: number,
  requesterId: number,
  userIds: number[],
): Promise<number[]> {
  await getGroupOrThrow(chatId);
  await assertAdmin(chatId, requesterId);
  await assertUsersExist(userIds);

  await prisma.chatMember.createMany({
    data: [...new Set(userIds)].map((userId) => ({ chatId, userId, role: MemberRole.MEMBER })),
    skipDuplicates: true,
  });

  const members = await prisma.chatMember.findMany({
    where: { chatId },
    select: { userId: true },
    orderBy: { joinedAt: 'asc' },
  });
  return members.map((m) => m.userId);
}

/** An admin can remove anyone; any member can remove themselves (leave). */
export async function removeGroupMember(
  chatId: number,
  requesterId: number,
  userId: number,
): Promise<number[]> {
  await getGroupOrThrow(chatId);
  const requesterRole = await assertMember(chatId, requesterId);
  if (requesterId !== userId && requesterRole !== MemberRole.ADMIN) {
    throw forbidden('Only a group admin can remove other members');
  }

  const target = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
  });
  if (!target) throw notFound(`User ${userId} is not a member of chat ${chatId}`);

  await prisma.$transaction(async (tx) => {
    await tx.chatMember.delete({ where: { chatId_userId: { chatId, userId } } });

    // If the last admin left, promote the longest-standing member so the group is never admin-less.
    if (target.role === MemberRole.ADMIN) {
      const adminsLeft = await tx.chatMember.count({ where: { chatId, role: MemberRole.ADMIN } });
      if (adminsLeft === 0) {
        const next = await tx.chatMember.findFirst({ where: { chatId }, orderBy: { joinedAt: 'asc' } });
        if (next) {
          await tx.chatMember.update({
            where: { chatId_userId: { chatId, userId: next.userId } },
            data: { role: MemberRole.ADMIN },
          });
        }
      }
    }
  });

  const members = await prisma.chatMember.findMany({
    where: { chatId },
    select: { userId: true },
    orderBy: { joinedAt: 'asc' },
  });
  return members.map((m) => m.userId);
}

export async function getChatDetails(chatId: number) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { members: { select: { userId: true, role: true }, orderBy: { joinedAt: 'asc' } } },
  });
  if (!chat) throw notFound(`Chat ${chatId} not found`);
  return {
    chatId: chat.id,
    type: chat.type,
    name: chat.name,
    createdAt: chat.createdAt,
    members: chat.members,
  };
}
