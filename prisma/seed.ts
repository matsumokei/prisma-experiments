import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient()

async function main() {
    console.log('Start seeding...')

    // Delete existing users to prevent duplication
    await prisma.user.deleteMany({})

    // Seed user data in a transaction
    await prisma.$transaction(async (tx) => {
        // Create multiple users
        const user1 = await tx.user.create({
            data: {
                email: 'alice@example.com',
                name: 'Alice',
            },
        })
        console.log(`Created user with ID: ${user1.id}`)

        const user2 = await tx.user.create({
            data: {
                email: 'bob@example.com',
                name: 'Bob',
            },
        })
        console.log(`Created user with ID: ${user2.id}`)

        const user3 = await tx.user.create({
            data: {
                email: 'charlie@example.com',
                name: 'Charlie',
            },
        })
        console.log(`Created user with ID: ${user3.id}`)
    })

    console.log('Seeding finished.')
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
