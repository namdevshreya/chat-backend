import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { chatRouter } from './routes/chat.routes';
import { groupRouter } from './routes/group.routes';
import { userRouter } from './routes/user.routes';

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(userRouter);
  app.use(chatRouter);
  app.use(groupRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
