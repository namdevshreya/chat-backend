import type { DocumentData, DocumentReference, Query, Timestamp } from 'firebase-admin/firestore';
import { FieldValue, firestore } from '../lib/firebase';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { assertChatExists, assertMember } from './chat.service';

/*
 * Firestore layout
 *
 *   chats/{chatId}/messages/{messageId}
 *       senderId   number
 *       text       string
 *       createdAt  Timestamp (server time)
 *       editedAt   Timestamp | null
 *       deleted    boolean            (soft delete)
 *       deletedAt  Timestamp | null
 *       readBy     { "<userId>": Timestamp }     <- read receipts
 *
 *   chats/{chatId}/lastSeen/{userId}
 *       userId, messageId, updatedAt
 */

const messagesCol = (chatId: number) =>
  firestore.collection('chats').doc(String(chatId)).collection('messages');

const lastSeenCol = (chatId: number) =>
  firestore.collection('chats').doc(String(chatId)).collection('lastSeen');

export interface MessageDto {
  id: string;
  chatId: number;
  senderId: number;
  text: string | null;
  createdAt: string | null;
  editedAt: string | null;
  deleted: boolean;
  readBy: Record<string, string>;
}

const iso = (value: unknown): string | null =>
  value && typeof (value as Timestamp).toDate === 'function' ? (value as Timestamp).toDate().toISOString() : null;

function toDto(chatId: number, id: string, data: DocumentData): MessageDto {
  const deleted = data.deleted === true;
  const readByRaw = (data.readBy ?? {}) as Record<string, unknown>;
  const readBy: Record<string, string> = {};
  for (const [userId, ts] of Object.entries(readByRaw)) {
    const value = iso(ts);
    if (value) readBy[userId] = value;
  }
  return {
    id,
    chatId,
    senderId: data.senderId as number,
    text: deleted ? null : (data.text as string),
    createdAt: iso(data.createdAt),
    editedAt: iso(data.editedAt),
    deleted,
    readBy,
  };
}

async function getMessageRefOrThrow(
  chatId: number,
  messageId: string,
): Promise<{ ref: DocumentReference<DocumentData>; data: DocumentData }> {
  const ref = messagesCol(chatId).doc(messageId);
  const snap = await ref.get();
  if (!snap.exists) throw notFound(`Message ${messageId} not found in chat ${chatId}`);
  return { ref, data: snap.data() as DocumentData };
}

// 2. Send message
export async function sendMessage(chatId: number, senderId: number, text: string): Promise<MessageDto> {
  await assertMember(chatId, senderId);

  const ref = messagesCol(chatId).doc();
  await ref.set({
    senderId,
    text,
    createdAt: FieldValue.serverTimestamp(),
    editedAt: null,
    deleted: false,
    deletedAt: null,
    readBy: {},
  });

  // Read back so the response carries the real server timestamp.
  const snap = await ref.get();
  return toDto(chatId, ref.id, snap.data() as DocumentData);
}

// 3. Get messages (oldest -> newest within the returned page)
export async function getMessages(
  chatId: number,
  limit: number,
  options: { userId?: number; before?: string } = {},
): Promise<{ messages: MessageDto[]; hasMore: boolean; nextBefore: string | null }> {
  if (options.userId !== undefined) await assertMember(chatId, options.userId);
  else await assertChatExists(chatId);

  let query: Query<DocumentData> = messagesCol(chatId).orderBy('createdAt', 'desc').limit(limit + 1);

  if (options.before) {
    const cursor = await messagesCol(chatId).doc(options.before).get();
    if (!cursor.exists) throw badRequest(`'before' message ${options.before} not found in chat ${chatId}`);
    query = query.startAfter(cursor);
  }

  const snap = await query.get();
  const hasMore = snap.docs.length > limit;
  const page = snap.docs.slice(0, limit);

  // Fetched newest-first for efficient paging; return in ascending timestamp order.
  const messages = page.reverse().map((d) => toDto(chatId, d.id, d.data()));
  return { messages, hasMore, nextBefore: hasMore ? (messages[0]?.id ?? null) : null };
}

// 4. Mark message read
export async function markMessageRead(
  chatId: number,
  messageId: string,
  userId: number,
): Promise<{ messageId: string; userId: number; readAt: string | null; alreadyRead: boolean }> {
  await assertMember(chatId, userId);
  const ref = messagesCol(chatId).doc(messageId);

  const alreadyRead = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound(`Message ${messageId} not found in chat ${chatId}`);
    const data = snap.data() as DocumentData;
    if (data.senderId === userId) throw badRequest('You cannot mark your own message as read');

    const readBy = (data.readBy ?? {}) as Record<string, unknown>;
    if (readBy[String(userId)]) return true; // idempotent: keep the first read time

    tx.update(ref, { [`readBy.${userId}`]: FieldValue.serverTimestamp() });
    return false;
  });

  const fresh = await ref.get();
  const readBy = ((fresh.data() as DocumentData).readBy ?? {}) as Record<string, unknown>;
  return { messageId, userId, readAt: iso(readBy[String(userId)]), alreadyRead };
}

// 5. Update last seen message
export async function updateLastSeen(
  chatId: number,
  userId: number,
  messageId: string,
): Promise<{ chatId: number; userId: number; messageId: string }> {
  await assertMember(chatId, userId);
  await getMessageRefOrThrow(chatId, messageId);

  await lastSeenCol(chatId)
    .doc(String(userId))
    .set({ userId, messageId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  return { chatId, userId, messageId };
}

export async function getLastSeen(
  chatId: number,
): Promise<Array<{ userId: number; messageId: string; updatedAt: string | null }>> {
  await assertChatExists(chatId);
  const snap = await lastSeenCol(chatId).get();
  return snap.docs.map((d) => {
    const data = d.data();
    return { userId: data.userId as number, messageId: data.messageId as string, updatedAt: iso(data.updatedAt) };
  });
}

// ---------- bonus: edit / delete ----------

export async function editMessage(
  chatId: number,
  messageId: string,
  senderId: number,
  text: string,
): Promise<MessageDto> {
  await assertMember(chatId, senderId);
  const { ref, data } = await getMessageRefOrThrow(chatId, messageId);

  if (data.senderId !== senderId) throw forbidden('You can only edit your own messages');
  if (data.deleted === true) throw badRequest('A deleted message cannot be edited');

  await ref.update({ text, editedAt: FieldValue.serverTimestamp() });
  const fresh = await ref.get();
  return toDto(chatId, ref.id, fresh.data() as DocumentData);
}

/** Soft delete: the document stays (so ordering and read receipts remain consistent) but its text is wiped. */
export async function deleteMessage(chatId: number, messageId: string, senderId: number): Promise<MessageDto> {
  await assertMember(chatId, senderId);
  const { ref, data } = await getMessageRefOrThrow(chatId, messageId);

  if (data.senderId !== senderId) throw forbidden('You can only delete your own messages');
  if (data.deleted === true) return toDto(chatId, ref.id, data);

  await ref.update({ text: '', deleted: true, deletedAt: FieldValue.serverTimestamp() });
  const fresh = await ref.get();
  return toDto(chatId, ref.id, fresh.data() as DocumentData);
}
