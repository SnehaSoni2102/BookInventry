import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// argon2id is the @node-rs/argon2 default algorithm.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
// No 0/O/1/l/I so a printed slip can be read aloud or typed without mistakes.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(plain: string): Promise<string> {
    return hash(plain, OPTIONS);
  }

  verify(hashed: string, plain: string): Promise<boolean> {
    return verify(hashed, plain).catch(() => false);
  }

  /** Burns the same CPU as a real check so unknown usernames are not distinguishable by timing. */
  async verifyDummy(plain: string): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing');
    await verify(await this.dummyHash, plain).catch(() => false);
  }

  generate(length = 10): string {
    let out = '';
    for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
    return out;
  }
}
