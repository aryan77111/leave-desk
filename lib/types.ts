export type Role = 'student' | 'faculty' | 'approver' | 'office';
export type LeaveType = 'medical' | 'family' | 'official';
export type LeaveStatus = 'submitted' | 'sanctioned' | 'documents_in' | 'approved' | 'rejected' | 'cancelled' | 'withdrawn';
export type AckStatus = 'pending' | 'acknowledged' | 'noted' | 'flagged' | 'deemed';
export type ApproverLevel = 'chair' | 'dean';

export type Person = {
  id: string;
  email: string;
  full_name: string;
  roles: Role[];
  student_no: string | null;
  programme: string | null;
  batch: string | null;
  section: string | null;
  approver_level: ApproverLevel | null;
  user_id: string | null;
  active: boolean;
};

export type Settings = {
  programme_name: string;
  timezone: string;
  notice_hours: number;
  medical_late_hours: number;
  medical_ahead_days: number;
  ack_hours: number;
  escalate_hours: number;
  doc_days: number;
  chair_max_days: number;
  max_leave_days: number;
  allowed_domains: string[];
  app_url: string | null;
  email_from: string | null;
  updated_at: string;
};

export type ClassSession = {
  id: string;
  course_code: string;
  course_name: string | null;
  faculty_id: string;
  batch: string;
  section: string;
  starts_at: string;
  ends_at: string | null;
  cancelled: boolean;
};

export type LeaveRequest = {
  id: string;
  ref: string;
  student_id: string;
  type: LeaveType;
  reason: string;
  from_date: string;
  to_date: string;
  away_from_campus: boolean;
  return_date: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: LeaveStatus;
  approver_level: ApproverLevel;
  submitted_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  doc_deadline: string | null;
  doc_path: string | null;
  doc_uploaded_at: string | null;
  doc_checked_at: string | null;
  escalated_at: string | null;
  closed_at: string | null;
};

export type LeaveEvent = {
  id: number;
  kind: string;
  message: string;
  created_at: string;
};

export type InboxItem = {
  leave_id: string;
  ref: string;
  type: LeaveType;
  status: LeaveStatus;
  from_date: string;
  to_date: string;
  submitted_at: string;
  reason: string | null;
  student_name: string;
  student_no: string;
  ack_status: AckStatus;
  note: string | null;
  responded_at: string | null;
  respond_by: string;
  sessions: { course_code: string; starts_at: string }[] | null;
};

export type ActionResult = { ok?: string; error?: string };
