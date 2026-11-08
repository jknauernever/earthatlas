-- applied to ep-proud-mountain-bcunimvx-pooler at 2026-11-05T20:49:49.592Z
create schema if not exists "auth";

alter table "auth"."user" add column "twoFactorEnabled" boolean default false;

create table "auth"."twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references "auth"."user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);

create table "auth"."passkey" ("id" text not null primary key, "name" text, "publicKey" text not null, "userId" text not null references "auth"."user" ("id") on delete cascade, "credentialID" text not null, "counter" integer not null, "deviceType" text not null, "backedUp" boolean not null, "transports" text, "createdAt" timestamptz, "aaguid" text);

create index "twoFactor_secret_idx" on "auth"."twoFactor" ("secret");

create index "twoFactor_userId_idx" on "auth"."twoFactor" ("userId");

create index "passkey_userId_idx" on "auth"."passkey" ("userId");

create index "passkey_credentialID_idx" on "auth"."passkey" ("credentialID");
