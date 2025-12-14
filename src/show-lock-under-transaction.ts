import { createPrismaClient } from './prisma.service.js';
import { PrismaClient, Prisma } from '@prisma/client'; // Prismaをインポート

const client: PrismaClient = createPrismaClient();
const MOVIE_NAME = 'Hidden Figures';
const USER_EMAIL_T1 = 'sorcha@prisma.io'; // T1 (ロック保持側)
const USER_EMAIL_T2 = 'ellen@prisma.io'; // T2 (ブロックされる側)

/**
 * 初期データを投入し、テスト環境を準備する関数
 */
async function setupData() {
  console.log('--- 1. 初期データ投入 ---');

  // 既存データの削除（クリーンアップ）
  // NOTE: 外部キー制約により、リレーションを持つ Seat から先に削除する必要がある
  await client.seat.deleteMany();
  await client.movie.deleteMany();
  await client.user.deleteMany();

  // 映画の作成
  const movie = await client.movie.create({
    data: {
      name: MOVIE_NAME,
    },
  });

  // ユーザーの作成 (T1とT2のユーザーを含む)
  await client.user.createMany({
    data: [
      { email: 'alice@prisma.io', name: 'Alice' },
      { email: USER_EMAIL_T1, name: 'Sorcha' }, // T1用
      { email: USER_EMAIL_T2, name: 'Ellen' }, // T2用
    ],
  });

  // 座席の作成 (ID=1の座席を作成し、version=0)
  // この座席が競合テストの対象となる
  await client.seat.create({
    data: {
      id: 1,
      version: 0,
      movieId: movie.id,
      // 修正: claimedBy: null, を削除。userIdが設定されていなければ自動的に未予約状態になる
    },
  });

  console.log(`✅ データ準備完了。映画: ${MOVIE_NAME}。座席ID: 1 (Version: 0)`);
}

/**
 * T1: ロックを獲得し、COMMIT前に一時停止するトランザクション
 */
async function transactionT1() {
  console.log(`\n--- T1 (${USER_EMAIL_T1}): 処理開始 ---`);
  const user = await client.user.findUnique({ where: { email: USER_EMAIL_T1 } });
  const availableSeat = await client.seat.findFirst({
    where: { movie: { name: MOVIE_NAME }, claimedBy: null },
  });

  if (!user || !availableSeat) {
    console.error('[T1] データ不足。setupDataを実行してください。');
    return;
  }

  try {
    // 🚨 修正: 分離レベルを上げることで、ブロッキングを確実に発生させる
    await client.$transaction(
      async (tx) => {
        console.log(`[T1] 🔄 UPDATE開始 (Version ${availableSeat.version}をチェック)`);

        // 1. Row Exclusive Lockを獲得し、Versionをインクリメントする
        const result = await tx.seat.updateMany({
          data: {
            userId: user.id, // 修正: 外部キーuserIdを直接使用
            version: { increment: 1 },
          },
          where: {
            id: availableSeat.id,
            version: availableSeat.version,
          },
        });

        if (result.count === 0) {
          console.log('[T1] ❌ 競合検出によりUPDATEスキップ (ロールバック)');
          throw new Error('Concurrency Conflict detected');
        }

        console.log(
          `[T1] ✅ UPDATE成功 (DB内でロックを獲得し、Versionを${
            availableSeat.version + 1
          }に設定済)`,
        );

        // 2. ロックがCOMMITまで維持されていることを確認するため、5秒間停止
        console.log('[T1] 🛑 5秒間一時停止中... (ここでT2はブロックされます)');

        // NOTE: T1がロックを保持していることを確認するクエリ
        const lockCheckQuery = `
                SELECT 
                    locktype,
                    database,
                    relation,
                    page, 
                    tuple, 
                    pid, 
                    mode, 
                    granted 
                FROM 
                    pg_locks
                ORDER BY pid, granted
            `;

        const locks = await tx.$queryRawUnsafe(lockCheckQuery);

        // ロック情報があればログに出力
        console.info(locks);
        // データベースの機能を使って停止させる
        await tx.$executeRaw`SELECT pg_sleep(6);`;

        console.log('[T1] ▶️ 停止解除。COMMIT実行。');
      },
      {
        // 修正: タイムアウトを7秒に延長し、pg_sleep(5)が完了する時間を確保する
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 7000, // 7秒に設定
      },
    );
    console.log(`[T1] ✅ トランザクション完了 (COMMIT済み)`);
  } catch (e) {
    // T2によって競合が検出された場合のロールバックはここではない
    console.error(`[T1] ❌ トランザクション失敗/ロールバック: ${e.message}`);
  }
}

/**
 * T2: T1によってブロックされ、Versionチェックに失敗するトランザクション
 */
async function transactionT2() {
  console.log(`\n--- T2 (${USER_EMAIL_T2}): 処理開始 (T1の直後に開始) ---`);
  const user = await client.user.findUnique({ where: { email: USER_EMAIL_T2 } });

  // T1と同じタイミングでREADが成功したと仮定 (Version 0)
  const availableSeat = await client.seat.findFirst({
    where: { movie: { name: MOVIE_NAME }, claimedBy: null },
  });

  if (!user || !availableSeat) {
    console.error('[T2] データ不足。');
    return;
  }

  console.log(`[T2] 読み込み完了: 座席ID ${availableSeat.id} (V${availableSeat.version})`);

  try {
    await client.$transaction(async (tx) => {
      console.log(`[T2] ➡️ UPDATE実行を試みる (T1がロックしているためブロックされるはず)`);
      const lockCheckQuery = `
                SELECT 
                    locktype,
                    database,
                    relation,
                    page, 
                    tuple, 
                    pid, 
                    mode, 
                    granted 
                FROM 
                    pg_locks
                ORDER BY pid, granted
            `;

      const locks = await client.$queryRawUnsafe(lockCheckQuery);

      // ロック情報があればログに出力
      console.info(locks);

      // T1と同じ行を同じWHERE条件でUPDATEを試みる
      const result = await client.seat.updateMany({
        data: {
          userId: user.id, // 修正: 外部キーuserIdを直接使用
          version: { increment: 1 },
        },
        where: {
          id: availableSeat.id,
          version: availableSeat.version,
        },
      });
      console.info(result);

      if (result.count === 0) {
        // T1がロックを解放した後、競合を検出する
        console.log(`[T2] ❌ 競合検出: T1によって既に更新されています。`);
        throw new Error(`Concurrency Conflict detected by T2`);
      } else {
        console.log(`[T2] ✅ T1が失敗したため、T2が成功しました。（このシナリオではまれ）`);
      }
    });
  } catch (e) {
    // T2がブロックされた後にエラーで失敗した場合
    console.log(`[T2] ❌ 最終失敗: ${e.message}`);
  }
}

// -----------------------------------------------------------
// 検証実行メインロジック
// -----------------------------------------------------------
async function validateLockAndVersionChange() {
  // データセットアップ (version=0の座席を準備)
  await setupData(); // <--- 初期データを投入

  console.log('\n--- 3. ロック持続性 検証開始 ---');

  // T1を最初に開始
  const t1Promise = transactionT1();

  // T2をわずかに遅延させて開始 (T1のUPDATE/ロック獲得後にT2がUPDATEを試みるようにする)
  await new Promise((resolve) => setTimeout(resolve, 500));
  const t2Promise = transactionT2();

  // 両方の処理が完了するのを待つ
  await Promise.all([t1Promise, t2Promise]);

  // 最終結果の確認
  const finalSeat = await client.seat.findUnique({
    where: { id: 1 },
    select: { version: true, claimedBy: { select: { name: true } } },
  });
  console.log(`\n--- 4. 最終DB状態 ---`);
  console.log(`最終バージョン: V${finalSeat?.version}`);
  console.log(`予約者: ${finalSeat?.claimedBy?.name || 'なし'}`);
}

validateLockAndVersionChange()
  .catch((e) => {
    console.error('検証中にアプリケーションエラー:', e);
  })
  .finally(async () => {
    await client.$disconnect();
  });
