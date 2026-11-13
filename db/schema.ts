import {sql} from 'drizzle-orm';
import {check,index,integer,sqliteTable,text} from 'drizzle-orm/sqlite-core';
/** Pending reservations retain replay protection after uncertain storage outcomes. */
export const mediaUploads=sqliteTable('media_uploads',{
 authId:text('auth_id').primaryKey(),pubkey:text('pubkey').notNull(),payloadHash:text('payload_hash').notNull(),objectKey:text('object_key').notNull().unique(),
 size:integer('size').notNull(),mime:text('mime').notNull(),day:integer('day').notNull(),createdAt:integer('created_at').notNull(),state:text('state',{enum:['pending','stored']}).notNull().default('pending'),
},t=>[index('media_uploads_day').on(t.day),index('media_uploads_pubkey_day').on(t.pubkey,t.day),check('media_uploads_positive_size',sql`${t.size}>0 AND ${t.size}<=30000000`),check('media_uploads_state',sql`${t.state} IN ('pending','stored')`)]);
