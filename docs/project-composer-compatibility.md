# Project composer compatibility

Project chat pages can expose a textbox labelled `New chat in <project name>`.
Composer selection retains the existing localized labels and accepts this dynamic
label without matching arbitrary textboxes. Composition still reads back the
field: an empty field after a nonempty fill is a verification failure, not success.

Visible error detection treats standalone `404` as a not-found signal. Digits
inside an accession such as `GSE240401` do not establish a missing page.

Regression coverage is in `project-composer-regression.test.ts`. These changes
do not alter API/protocol shape or authorize retrying an uncertain submission.
