# How answers are produced

A question is embedded, the closest chunks are retrieved from pgvector, and those
chunks are given to the model as context. The model is instructed to answer only
from that context, and that context is treated as data, never as instructions.

Every answer carries citations back to the documents it drew on, so a reader can
check the source rather than trust the phrasing.

When the retrieved context does not contain the answer, Deskbell refuses instead
of guessing. A refusal is recorded as a documentation gap, not as a failure — it
is the most useful signal the product produces, because it tells you what to
write next.

Models are configured with environment variables. `DESKBELL_CHAT_MODEL` selects
the answering model and `DESKBELL_EMBEDDING_MODEL` the embedding model, both
written as `provider/model`. Changing the embedding model requires re-indexing,
because existing vectors were produced by the old one.
