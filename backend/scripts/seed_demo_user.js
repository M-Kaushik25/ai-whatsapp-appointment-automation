const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: { business: true },
    take: 5
  });

  console.log('--- EXISTING SAMPLE USERS ---');
  for (const u of users) {
    console.log(`Email: ${u.email} | Role: ${u.role} | Business: ${u.business?.name}`);
  }

  // Ensure a clean default demo account exists: admin@example.com / Password123!
  const demoEmail = 'admin@example.com';
  const demoPassword = 'Password123!';
  const hashedPassword = await bcrypt.hash(demoPassword, 10);

  let demoUser = await prisma.user.findUnique({
    where: { email: demoEmail },
    include: { business: true }
  });

  if (!demoUser) {
    let biz = await prisma.business.findFirst();
    if (!biz) {
      biz = await prisma.business.create({
        data: {
          name: 'Royal Spa & Salon',
          slug: 'royal-spa-salon',
          settings: JSON.stringify({
            theme: 'light',
            timezone: 'Asia/Kolkata',
            bufferMinutes: 0,
            minimumBookingNoticeMinutes: 60,
            maximumAdvanceBookingDays: 30
          })
        }
      });
    }

    demoUser = await prisma.user.create({
      data: {
        email: demoEmail,
        password: hashedPassword,
        role: 'OWNER',
        businessId: biz.id
      },
      include: { business: true }
    });
    console.log(`\nCreated demo account: ${demoEmail}`);
  } else {
    await prisma.user.update({
      where: { email: demoEmail },
      data: { password: hashedPassword }
    });
    console.log(`\nUpdated demo account password for: ${demoEmail}`);
  }

  console.log(`\n--- READY-TO-USE LOGIN CREDENTIALS ---`);
  console.log(`Email:    ${demoEmail}`);
  console.log(`Password: ${demoPassword}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
