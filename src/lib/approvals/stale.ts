// 0162 (F-09): an approval applies only to the exact version the approver
// reviewed. When the record moved underneath the approval screen the database
// raises ST001 and nothing is written; the approver is told to look again.
//
// One fixed sentence, shared by every approval action, so the screens never
// leak a SQLSTATE, a column name, a timestamp or a row id.
export const STALE_MESSAGE =
  "This record changed after you opened it. Refresh and review it again before approving.";
