import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Phase 3 & 4 data for ABC Salon...');

  // 1. Create or update Business with timezone and booking rules
  let business = await prisma.business.findUnique({
    where: { slug: 'abc-salon' },
  });

  const businessSettings = JSON.stringify({
    theme: 'light',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    bufferMinutes: 0,
    minimumBookingNoticeMinutes: 60,
    maximumAdvanceBookingDays: 30,
  });

  if (!business) {
    business = await prisma.business.create({
      data: {
        name: 'ABC Salon',
        slug: 'abc-salon',
        phone: '+919876543200',
        settings: businessSettings,
      },
    });
  } else {
    business = await prisma.business.update({
      where: { id: business.id },
      data: { settings: businessSettings },
    });
  }

  // 2. Create Owner User
  const existingOwner = await prisma.user.findUnique({
    where: { email: 'owner@abcsalon.com' },
  });

  if (!existingOwner) {
    const hashedPassword = await bcrypt.hash('password123', 10);
    await prisma.user.create({
      data: {
        email: 'owner@abcsalon.com',
        password: hashedPassword,
        role: 'OWNER',
        businessId: business.id,
      },
    });
  }

  // 3. Create Services
  const servicesData = [
    {
      name: 'Haircut',
      description: 'Professional precision haircut and styling',
      durationMinutes: 30,
      price: 500,
      depositType: 'FIXED',
      depositValue: 100,
      active: true,
    },
    {
      name: 'Hair Spa',
      description: 'Relaxing scalp massage and deep conditioning hair spa',
      durationMinutes: 60,
      price: 1000,
      depositType: 'PERCENTAGE',
      depositValue: 20,
      active: true,
    },
    {
      name: 'Hair Coloring',
      description: 'Full hair coloring and gloss treatment',
      durationMinutes: 120,
      price: 2000,
      depositType: 'FIXED',
      depositValue: 500,
      active: true,
    },
  ];

  const serviceMap = new Map<string, any>();
  for (const s of servicesData) {
    const svc = await prisma.service.upsert({
      where: {
        businessId_name: {
          businessId: business.id,
          name: s.name,
        },
      },
      update: s,
      create: {
        ...s,
        businessId: business.id,
      },
    });
    serviceMap.set(s.name, svc);
  }

  // 4. Create Staff
  const staffList = [
    {
      name: 'Priya',
      phone: '+919876543210',
      email: 'priya@abcsalon.com',
      services: ['Haircut', 'Hair Spa', 'Hair Coloring'],
      workingDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
      start: '10:00',
      end: '19:00',
      breakTime: { start: '13:00', end: '14:00' },
      leaves: [
        {
          startDate: new Date('2026-09-10T00:00:00.000Z'),
          endDate: new Date('2026-09-10T23:59:59.000Z'),
          reason: 'Personal leave',
        },
      ],
    },
    {
      name: 'Arun',
      phone: '+919876543211',
      email: 'arun@abcsalon.com',
      services: ['Haircut'],
      workingDays: [1, 2, 3, 4, 5], // Mon-Fri
      start: '09:00',
      end: '18:00',
      breakTime: { start: '13:00', end: '14:00' },
      leaves: [],
    },
    {
      name: 'Divya',
      phone: '+919876543212',
      email: 'divya@abcsalon.com',
      services: ['Hair Spa'],
      workingDays: [0, 2, 3, 4, 5, 6], // Sun, Tue-Sat
      start: '10:00',
      end: '19:00',
      breakTime: { start: '14:00', end: '15:00' },
      leaves: [],
    },
  ];

  const staffMap = new Map<string, any>();
  for (const st of staffList) {
    let staffMember = await prisma.staff.findFirst({
      where: { businessId: business.id, name: st.name },
    });

    if (!staffMember) {
      staffMember = await prisma.staff.create({
        data: {
          businessId: business.id,
          name: st.name,
          phone: st.phone,
          email: st.email,
          active: true,
        },
      });
    }
    staffMap.set(st.name, staffMember);

    // Assign services
    for (const sName of st.services) {
      const svc = serviceMap.get(sName);
      if (svc) {
        await prisma.staffService.upsert({
          where: {
            staffId_serviceId: {
              staffId: staffMember.id,
              serviceId: svc.id,
            },
          },
          update: {},
          create: {
            businessId: business.id,
            staffId: staffMember.id,
            serviceId: svc.id,
          },
        });
      }
    }

    // Set working hours for all 7 days (0..6)
    for (let day = 0; day <= 6; day++) {
      const isWorking = st.workingDays.includes(day);
      await prisma.staffWorkingHours.upsert({
        where: {
          staffId_dayOfWeek: {
            staffId: staffMember.id,
            dayOfWeek: day,
          },
        },
        update: {
          startTime: st.start,
          endTime: st.end,
          enabled: isWorking,
        },
        create: {
          businessId: business.id,
          staffId: staffMember.id,
          dayOfWeek: day,
          startTime: st.start,
          endTime: st.end,
          enabled: isWorking,
        },
      });

      // Add break for working days
      if (isWorking) {
        const existingBreak = await prisma.staffBreak.findFirst({
          where: { staffId: staffMember.id, dayOfWeek: day },
        });
        if (!existingBreak) {
          await prisma.staffBreak.create({
            data: {
              businessId: business.id,
              staffId: staffMember.id,
              dayOfWeek: day,
              startTime: st.breakTime.start,
              endTime: st.breakTime.end,
            },
          });
        }
      }
    }

    // Add leaves
    for (const l of st.leaves) {
      const existingLeave = await prisma.staffLeave.findFirst({
        where: {
          staffId: staffMember.id,
          startDate: l.startDate,
        },
      });
      if (!existingLeave) {
        await prisma.staffLeave.create({
          data: {
            businessId: business.id,
            staffId: staffMember.id,
            startDate: l.startDate,
            endDate: l.endDate,
            reason: l.reason,
          },
        });
      }
    }
  }

  // 5. Create Business Holidays
  const holidaysData = [
    { date: new Date('2026-09-15T00:00:00.000Z'), name: 'Business Holiday' },
    { date: new Date('2026-12-25T00:00:00.000Z'), name: 'Christmas' },
  ];

  for (const h of holidaysData) {
    await prisma.businessHoliday.upsert({
      where: {
        businessId_date: {
          businessId: business.id,
          date: h.date,
        },
      },
      update: { name: h.name },
      create: {
        businessId: business.id,
        date: h.date,
        name: h.name,
      },
    });
  }

  // 6. Create Customer & Appointments (Phase 4)
  const customer = await prisma.customer.upsert({
    where: {
      businessId_phone: {
        businessId: business.id,
        phone: '+919811122233',
      },
    },
    update: { name: 'Rahul Sharma', email: 'rahul@example.com' },
    create: {
      businessId: business.id,
      name: 'Rahul Sharma',
      phone: '+919811122233',
      email: 'rahul@example.com',
    },
  });

  const haircutSvc = serviceMap.get('Haircut');
  const priyaStaff = staffMap.get('Priya');

  if (haircutSvc && priyaStaff) {
    // Tomorrow at 11:00 AM UTC
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startAt = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 11, 0, 0));
    const endAt = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 11, 30, 0));

    const existingAppt = await prisma.appointment.findFirst({
      where: {
        staffId: priyaStaff.id,
        startAt,
      },
    });

    if (!existingAppt) {
      await prisma.appointment.create({
        data: {
          businessId: business.id,
          customerId: customer.id,
          staffId: priyaStaff.id,
          serviceId: haircutSvc.id,
          startAt,
          endAt,
          status: 'CONFIRMED',
          price: haircutSvc.price,
          depositAmount: 100,
          paymentStatus: 'UNPAID',
          notes: 'Customer prefers scissor cut',
        },
      });
    }
  }

  console.log('Phase 3 & 4 Seed completed successfully for ABC Salon!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
