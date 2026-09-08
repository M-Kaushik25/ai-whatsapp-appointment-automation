export interface UpdateReminderSettingsDto {
  remindersEnabled?: boolean;
  firstReminderMinutes?: number;
  firstReminderEnabled?: boolean;
  secondReminderMinutes?: number;
  secondReminderEnabled?: boolean;
  ownerNotificationEnabled?: boolean;
  ownerNotificationPhone?: string;
}

export interface NotificationFiltersDto {
  type?: string;
  status?: string;
  appointmentId?: string;
  customerId?: string;
  search?: string;
  page?: number;
  limit?: number;
}
