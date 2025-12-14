import { createPrismaClient } from "./prisma.service.js";

const prisma = createPrismaClient();

// Main function to perform database operations.
async function claimSeat(userId: number): Promise<void> {
  const movieName = 'Hidden Figures'

  // Find first available seat
  const availableSeat = await prisma.seat.findFirst({
    where: {
      movie: {
        name: movieName,
      },
      claimedBy: null,
    },
  })

  // Throw an error if no seats are available
  if (!availableSeat) {
    throw new Error(`Oh no! ${movieName} is all booked.`)
  }

  // Claim the seat
  await prisma.seat.update({
    data: {
      claimedBy: {
        connect: {
          id: userId,
        },
      },
    },
    where: {
      id: availableSeat.id,
    },
  });

  console.log(`Successfully claimed seat ${availableSeat.id} for user ${userId}.`)
}

/**
 * Main function to execute the claimSeat logic and handle the database lifecycle.
 */
async function main() {
  await claimSeat(1) // Example: claim a seat for a user with ID 1
  await claimSeat(2);
}

// Call the main function and handle the database connection lifecycle.
main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('An error occurred:', e)
    await prisma.$disconnect()
    process.exit(1)
  })