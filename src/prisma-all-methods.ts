import { createPrismaClient } from './prisma.service.js';

const prisma = createPrismaClient();

async function main() {
  // DB初期化（既存データをクリア）
  console.log('Clearing existing data...');
  await prisma.seat.deleteMany({});
  await prisma.tag.deleteMany({});
  await prisma.movie.deleteMany({});
  await prisma.user.deleteMany({});
  console.log('Database cleared.');

  // User
  const user1 = await prisma.user.create({
    data: { name: 'Alice', email: 'alice@example.com' },
  });
  await prisma.user.findMany();
  await prisma.user.findUnique({ where: { id: user1.id } });
  await prisma.user.update({ where: { id: user1.id }, data: { name: 'Alice2' } });

  const user2 = await prisma.user.create({
    data: { name: 'Bob', email: 'bob@example.com' },
  });
  await prisma.user.delete({ where: { id: user2.id } });
  await prisma.user.upsert({
    where: { id: user2.id },
    update: { name: 'Bob2' },
    create: { name: 'Bob', email: 'bob@example.com' },
  });
  await prisma.user.count();
  await prisma.user.aggregate({ _max: { id: true } });
  await prisma.user.groupBy({ by: ['name'], _count: { _all: true } });

  // Seat
  const seat1 = await prisma.seat.create({
    data: { movieId: (await prisma.movie.create({ data: { name: 'Movie1' } })).id, version: 0 },
  });
  await prisma.seat.findMany();
  await prisma.seat.findUnique({ where: { id: seat1.id } });
  await prisma.seat.update({ where: { id: seat1.id }, data: { userId: user1.id } });

  const seat2 = await prisma.seat.create({
    data: { movieId: (await prisma.movie.create({ data: { name: 'Movie2' } })).id, version: 0 },
  });
  await prisma.seat.delete({ where: { id: seat2.id } });
  await prisma.seat.upsert({
    where: { id: seat2.id },
    update: { userId: user1.id },
    create: { movieId: (await prisma.movie.create({ data: { name: 'Movie3' } })).id, version: 0 },
  });
  await prisma.seat.count();
  await prisma.seat.aggregate({ _max: { id: true } });
  await prisma.seat.groupBy({ by: ['userId'], _count: { _all: true } });

  // Movie
  const movie1 = await prisma.movie.create({ data: { name: 'Movie4' } });
  await prisma.movie.findMany();
  await prisma.movie.findUnique({ where: { id: movie1.id } });
  await prisma.movie.update({ where: { id: movie1.id }, data: { name: 'MovieX' } });

  const movie2 = await prisma.movie.create({ data: { name: 'MovieY' } });
  await prisma.movie.delete({ where: { id: movie2.id } });
  await prisma.movie.upsert({
    where: { id: movie2.id },
    update: { name: 'MovieZ' },
    create: { name: 'MovieZ' },
  });
  await prisma.movie.count();
  await prisma.movie.aggregate({ _max: { id: true } });
  await prisma.movie.groupBy({ by: ['name'], _count: { _all: true } });

  // Tag
  const tag1 = await prisma.tag.create({ data: { name: 'Tag1' } });
  await prisma.tag.findMany();
  await prisma.tag.findUnique({ where: { id: tag1.id } });
  await prisma.tag.update({ where: { id: tag1.id }, data: { name: 'TagX' } });

  const tag2 = await prisma.tag.create({ data: { name: 'TagY' } });
  await prisma.tag.delete({ where: { id: tag2.id } });
  await prisma.tag.upsert({
    where: { id: tag2.id },
    update: { name: 'TagZ' },
    create: { name: 'TagZ' },
  });
  await prisma.tag.count();
  await prisma.tag.aggregate({ _max: { id: true } });
  await prisma.tag.groupBy({ by: ['name'], _count: { _all: true } });

  // Join/リレーション操作
  // Seat と Movie のjoin
  await prisma.seat.findMany({
    include: {
      movie: true,
      claimedBy: true,
    },
  });

  // Movie と Seat のjoin
  await prisma.movie.findMany({
    include: {
      seats: true,
    },
  });

  // トランザクション
  // 基本的なトランザクション（複数操作をまとめて実行）
  console.log('\n=== Transaction 1: Basic Transaction ===');
  await prisma.$transaction(async (tx) => {
    console.log('Transaction started');
    await tx.user.create({ data: { name: 'TxUser', email: 'tx@example.com' } });
    await tx.movie.create({ data: { name: 'TxMovie' } });
    console.log('Transaction committed');
  });

  // トランザクション（エラーが発生したらロールバック）
  console.log('\n=== Transaction 2: Rollback on Error ===');
  try {
    await prisma.$transaction(async (tx) => {
      console.log('Transaction started');
      await tx.user.create({
        data: { name: 'TxUser2', email: 'tx2@example.com' },
      });
      // ここでエラーが発生すればロールバック
      const result = await tx.seat.findUnique({ where: { id: 99999 } });
      if (!result) throw new Error('Seat not found');
    });
  } catch (e) {
    console.error('Transaction failed and rolled back:', e);
  }

  // 複数のクエリをトランザクション内で実行
  console.log('\n=== Transaction 3: Multiple Operations ===');
  await prisma.$transaction(async (tx) => {
    console.log('Transaction started');
    const user = await tx.user.create({
      data: { name: 'TxUser3', email: 'tx3@example.com' },
    });
    const movie = await tx.movie.create({ data: { name: 'TxMovie3' } });
    const seat = await tx.seat.create({
      data: {
        userId: user.id,
        movieId: movie.id,
        version: 0,
      },
    });
    console.log('Transaction committed');
    return { user, movie, seat };
  });

  // トランザクション分離レベル指定
  console.log('\n=== Transaction 4: With Isolation Level ===');
  await prisma.$transaction(
    async (tx) => {
      console.log('Transaction started with ReadCommitted isolation level');
      await tx.user.create({
        data: { name: 'TxUser4', email: 'tx4@example.com' },
      });
      console.log('Transaction committed');
    },
    {
      isolationLevel: 'ReadCommitted',
    },
  );

  // ロック（SELECT FOR UPDATE）
  console.log('\n=== Locking with SELECT FOR UPDATE ===');
  await prisma.$transaction(async (tx) => {
    console.log('Transaction started with row lock');
    // ネイティブSQL でロックをかけて読み込み
    const lockedSeat = await tx.$queryRaw`
      SELECT * FROM "Seat" WHERE "id" = ${seat1.id} FOR UPDATE
    `;
    console.log('Locked seat:', lockedSeat);
    // ロック中に別の操作も可能
    await tx.seat.update({
      where: { id: seat1.id },
      data: { userId: user1.id },
    });
    console.log('Updated locked seat');
    console.log('Transaction committed (lock released)');
  });
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
