"""Reject SQL NULL evidence and unknown numeric bases explicitly."""

from alembic import op

revision = "c93da8e4f598"
down_revision = "b82c97d3e487"
branch_labels = depends_on = None


def upgrade():
    op.execute("""
    ALTER TABLE hms.billing_collection_transactions DROP CONSTRAINT
      ck_billing_collection_transactions_evidence_valid;
    ALTER TABLE hms.billing_collection_transactions ADD CONSTRAINT
      ck_billing_collection_transactions_evidence_valid CHECK
      (coalesce((collector='hotel' AND length(trim(payment_method))>0 AND
       (lower(trim(payment_method))='cash' OR length(trim(reference))>0)) OR
       (collector='channel' AND component='accommodation' AND capture_id IS NOT NULL
        AND length(trim(reference))>0),false));
    ALTER TABLE hms.guest_obligation_bases DROP CONSTRAINT ck_guest_obligation_bases_basis_valid;
    ALTER TABLE hms.guest_obligation_bases ADD CONSTRAINT ck_guest_obligation_bases_basis_valid
      CHECK(coalesce((status='known' AND accommodation_minor BETWEEN 0 AND 9007199254740991)
        OR (status='unknown' AND accommodation_minor IS NULL),false));
    """)


def downgrade():
    raise RuntimeError("Financial safeguards require a reviewed downgrade plan")
