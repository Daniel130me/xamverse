//! Sync category registry and per-category policies.
//!
//! WHY THIS EXISTS
//! ---------------
//! Categories decide how the apply pipeline treats an incoming op: which are
//! immutable (exam snapshots, finalized submissions), which are restricted
//! (identity/permission records only accepted from paired, trusted devices),
//! and which conflict strategy applies by default. This is *data*, not code
//! paths — one registry, one pipeline.
//!
//! The registry is the UNION of the Phase 1 prototype's 12 payload types and
//! the Phase 2 specification's generic categories, so nothing the prototype
//! simulates is silently rejected later. Unknown categories are quarantined
//! with a conflict record — never treated as successful no-ops (spec §12).

use crate::conflict::ConflictStrategy;

#[derive(Debug, Clone, Copy)]
pub struct CategoryPolicy {
    /// Only revision 1 is ever accepted (immutable snapshot semantics).
    pub immutable: bool,
    /// Strategy applied when no explicit resolution is configured.
    pub default_conflict: ConflictStrategy,
    /// Only accepted from devices that are paired AND trusted for the school.
    pub restricted: bool,
}

const fn standard() -> CategoryPolicy {
    CategoryPolicy {
        immutable: false,
        default_conflict: ConflictStrategy::Manual,
        restricted: false,
    }
}

const fn restricted() -> CategoryPolicy {
    CategoryPolicy {
        immutable: false,
        default_conflict: ConflictStrategy::Quarantine,
        restricted: true,
    }
}

const fn immutable() -> CategoryPolicy {
    CategoryPolicy {
        immutable: true,
        default_conflict: ConflictStrategy::Reject,
        restricted: false,
    }
}

/// All categories the engine understands, with their policies.
pub static CATEGORIES: &[(&str, CategoryPolicy)] = &[
    // --- identity / authorization (restricted: signed, trusted senders only)
    ("device_identity", restricted()),
    ("identity_records", restricted()), // spec §12 alias
    ("role_permissions", restricted()),
    ("permissions", restricted()), // Phase 1 name
    ("staff_records", restricted()),
    ("student_records", restricted()),
    // --- school configuration
    ("school_settings", standard()),
    // --- content lifecycle
    ("question_bank", standard()),
    ("assessment_revision", standard()),
    ("assessment_package", immutable()),
    ("approval_request", standard()),
    ("approval_decision", standard()),
    ("approval_event", standard()),
    // --- examinations (immutable once finalized)
    ("exam_attempt", immutable()),
    ("exam_attempt_event", standard()),
    ("submission", immutable()),
    ("result_set", standard()),
    ("result_revision", standard()),
    // --- platform
    ("audit_event", standard()),
    ("backup_metadata", standard()),
    ("update_package", standard()),
    ("conflict_resolution", standard()),
];

pub fn policy_for(category: &str) -> Option<CategoryPolicy> {
    CATEGORIES
        .iter()
        .find(|(name, _)| *name == category)
        .map(|(_, policy)| *policy)
}

pub fn is_known(category: &str) -> bool {
    policy_for(category).is_some()
}

/// Categories that participate in result collection by default.
pub const RESULT_CATEGORIES: &[&str] = &["exam_attempt", "submission", "result_set"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_phase1_payload_type_is_registered() {
        for name in [
            "approval_request",
            "approval_decision",
            "assessment_package",
            "question_bank",
            "student_records",
            "staff_records",
            "submission",
            "result_set",
            "permissions",
            "school_settings",
            "update_package",
            "conflict_resolution",
        ] {
            assert!(is_known(name), "missing Phase 1 category {name}");
        }
    }

    #[test]
    fn every_spec12_category_is_registered() {
        for name in [
            "identity_records",
            "role_permissions",
            "school_settings",
            "student_records",
            "staff_records",
            "question_bank",
            "assessment_revision",
            "approval_event",
            "assessment_package",
            "exam_attempt",
            "submission",
            "result_revision",
            "audit_event",
            "backup_metadata",
            "update_package",
        ] {
            assert!(is_known(name), "missing spec §12 category {name}");
        }
    }

    #[test]
    fn exam_categories_are_immutable() {
        assert!(policy_for("assessment_package").unwrap().immutable);
        assert!(policy_for("exam_attempt").unwrap().immutable);
        assert!(policy_for("submission").unwrap().immutable);
        assert!(!policy_for("question_bank").unwrap().immutable);
    }

    #[test]
    fn unknown_category_is_not_silently_accepted() {
        assert!(!is_known("free_form_data"));
    }
}
