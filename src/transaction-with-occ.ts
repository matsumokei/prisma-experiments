import { createPrismaClient } from './prisma.service.js';

// Prisma Clientのインスタンス化をファクトリ関数に置き換え
const client = createPrismaClient();

/**
 * 初期データを投入し、テスト環境を準備する関数
 */
async function setupData() {
  console.log('--- 1. 初期データ投入 ---');

  // 既存データの削除（クリーンアップ）
  await client.seat.deleteMany();
  await client.movie.deleteMany();
  await client.user.deleteMany();

  // 映画の作成
  const movie = await client.movie.create({
    data: {
      name: 'Hidden Figures',
    },
  });

  // ユーザーの作成
  await client.user.createMany({
    data: [
      { email: 'alice@prisma.io', name: 'Alice' },
      { email: 'sorcha@prisma.io', name: 'Sorcha' },
      { email: 'ellen@prisma.io', name: 'Ellen' },
    ],
  });

  // 座席の作成 (ID=1の座席を作成し、version=0)
  await client.seat.create({
    data: {
      id: 1,
      version: 0,
      movieId: movie.id,
    },
  });

  console.log(`✅ データ準備完了。映画ID: ${movie.id}。座席ID: 1 (Version: 0)`);
}

/**
 * Optimistic Concurrency Control (OCC) を実行するロジック
 * @param userEmail - 予約を試みるユーザーのメールアドレス
 */
async function reserveSeatOCC(userEmail: string, movieName: string) {
  console.log(`\n--- 2. 予約開始: ${userEmail} ---`);

  // AliceのユーザーIDを取得
  const user = await client.user.findUnique({ where: { email: userEmail } });
  if (!user) {
    console.error(`ユーザー ${userEmail} が見つかりません。`);
    return;
  }

  // 1. Find the first available seat (READ PHASE)
  console.info("Start find the first available seat")
  const availableSeat = await client.seat.findFirst({
    where: {
      movie: { name: movieName },
      claimedBy: null, // まだ誰にも予約されていない
    },
  });

  if (!availableSeat) {
    console.log(`❌ ${userEmail}: ${movieName} は既に満席です。`);
    return;
  }

  console.log(`✅ ${userEmail}: 座席ID ${availableSeat.id} (V${availableSeat.version}) を発見。`);

  // 2. Claim the seat using OCC (WRITE PHASE)
  // ここで、バージョンが読み込んだ時(availableSeat.version)と同じであることを確認します
  try {
    console.info("claim the seat")
    const result = await client.seat.updateMany({
      data: {
        userId: user.id,
        version: { increment: 1 }, // バージョンをインクリメント
      },
      where: {
        id: availableSeat.id,
        version: availableSeat.version, // KEY: 読み込んだバージョンとDBのバージョンが一致すること
      },
    });

    if (result.count === 0) {
      // 競合が発生した場合 (誰かが先に更新した)
      console.log(
        `❌ ${userEmail}: 予約失敗。座席ID ${availableSeat.id} は既に他の人に予約されました。`,
      );
      throw new Error(`That seat is already booked! Please try again.`);
    } else {
      console.log(
        `✅ ${userEmail}: 座席ID ${availableSeat.id} の予約に成功しました (新V${
          availableSeat.version + 1
        })。`,
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('already booked')) {
      // OCCによる予約失敗
      console.log(`--- ${userEmail} は処理を終了します ---`);
    } else {
      console.error(`重大なエラーが発生しました:`, e);
    }
  }
}

/**
 * 競合をシミュレーションするためのメイン関数
 */
async function simulateConflict() {
  await setupData();

  const movieName = 'Hidden Figures';

  // 目的: SorchaとEllenが同時にversion=0の座席を読み込む状況を作り出す。

  // 競合シミュレーション（意図的に非同期で実行）
  const reservations = [
    reserveSeatOCC('sorcha@prisma.io', movieName), // T1: 先にコミットする
    reserveSeatOCC('ellen@prisma.io', movieName), // T2: 読み込みはT1と同時だが、更新はT1の後になる
  ];

  console.log('\n--- 3. 競合シナリオ実行 (Promise.allで同時実行をシミュレート) ---');
  // Promise.allで2つの予約処理を同時に開始します。
  await Promise.all(reservations);

  // 最終結果の確認
  console.log('\n--- 4. 最終的なデータベースの状態 ---');
  const finalSeat = await client.seat.findUnique({
    where: { id: 1 },
    select: {
      id: true,
      version: true,
      claimedBy: { select: { name: true, email: true } },
    },
  });

  if (finalSeat?.claimedBy) {
    console.log(`最終予約成功: ${finalSeat.claimedBy.name} (${finalSeat.claimedBy.email})`);
    console.log(`最終バージョン: V${finalSeat.version}`);
  } else {
    console.log('最終的に誰も予約できませんでした。');
  }
}

simulateConflict()
  .catch((e) => {
    console.error('アプリケーション全体の実行中にエラー:', e);
  })
  .finally(async () => {
    await client.$disconnect();
  });

// ----------------------------------------------------------------------
// 必要なPrismaスキーマの定義 (schema.prisma)
/* model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
  seats Seat[]
}

model Movie {
  id    Int     @id @default(autoincrement())
  name  String  @unique
  seats Seat[]
}

model Seat {
  id        Int     @id 
  userId    Int?
  claimedBy User?   @relation(fields: [userId], references: [id])
  movieId   Int
  movie     Movie   @relation(fields: [movieId], references: [id])
  version   Int     // Optimistic Concurrency Control のためのバージョンフィールド
  @@unique([id, version]) // 必要に応じて複合ユニークインデックスも検討
}
*/
