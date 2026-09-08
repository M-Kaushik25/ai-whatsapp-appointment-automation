export interface UpdateRetentionSettingsDto {
  rebookingFollowUpEnabled?: boolean;
  rebookingFollowUpDays?: number;
}

export interface RetentionFiltersDto {
  status?: string;
  search?: string;
  customerId?: string;
  sourceAppointmentId?: string;
  page?: number;
  limit?: number;
}
