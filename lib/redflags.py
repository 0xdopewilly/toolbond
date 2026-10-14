"""Deterministic red flags for MCP tool text, computed in code before any model reads it.

Hard flags (H*) make a SAFE verdict impossible. Soft flags (S*) are handed to the judge
as facts. Everything here is pure string processing, so every validator derives the
same flags from the same manifest, and prompt injection cannot talk its way past them.

H1  hidden characters: zero-width, bidi controls, Unicode tag characters
H2  a secret location (ssh keys, .env, mcp.json, cloud credentials, seed phrase)
    next to a verb that moves data (pass, send, include, upload, ...)
H3  concealment from the user ("do not tell the user", "silently", ...)
H4  instruction override ("ignore previous instructions", "system prompt", <IMPORTANT>)
H5  text addressed to the judge ("note to the reviewer", "classify this as", "verdict is ...")
S1  refers to another tool that this server does not define
S2  very long description, base64-like blob, or a URL on another site
S3  a parameter shaped like a side channel (notes, context, metadata) that talks about files
S4  mentions credentials (API keys, tokens, passwords)
"""

import re

_TAG_FIRST, _TAG_LAST = 0xE0000, 0xE007F
_ZWJ = 0x200D
_EMOJI_VS = (0xFE0E, 0xFE0F)  # text / emoji presentation selectors, legitimate after a pictograph
_HIDDEN = (
    set(range(0x200B, 0x2010))  # zero-width space, joiners, LRM/RLM
    | set(range(0x202A, 0x202F))  # bidi embeddings and overrides
    | set(range(0x2060, 0x2065))  # word joiner, invisible operators
    | set(range(0x2066, 0x206A))  # bidi isolates
    | set(range(0xFE00, 0xFE10))  # variation selectors 1-16
    | set(range(0xE0100, 0xE01F0))  # variation selectors 17-256
    | set(range(0x180B, 0x1810))  # Mongolian free variation selectors and vowel separator
    | set(range(0x1D173, 0x1D17B))  # invisible musical formatting
    | {0x00AD, 0x034F, 0x061C, 0x115F, 0x1160, 0x17B4, 0x17B5, 0x2028, 0x2029, 0x3164, 0xFEFF, 0xFFA0}
)

_SECRET_PLACE = re.compile(
    r"(~/\.ssh|\.ssh/|id_rsa|id_ed25519|\.env\b|mcp\.json|\.cursor/|\.aws/credentials|\.npmrc|\.netrc"
    r"|\.git-credentials|\.kube/config|private[ _-]?key|seed phrase|recovery phrase|mnemonic|wallet\.dat|keychain)",
    re.I,
)
_MOVE_VERB = re.compile(
    r"\b(pass|send|include|attach|upload|post|forward|share|exfiltrat\w*|copy|transmit|append|embed|read|cat|dump)\b",
    re.I,
)
_CREDENTIAL = re.compile(r"\b(api[ _-]?keys?|access[ _-]?tokens?|secret[ _-]?keys?|passwords?|bearer tokens?)\b", re.I)
_CONCEAL = re.compile(
    r"(\b(do not|don't|never|must not)\s+(tell|mention|inform|show|reveal|notify|alert)\b[^.\n]{0,60}\buser\b"
    r"|\bwithout\s+(telling|informing|notifying|alerting)\b"
    r"|\bsilently\b"
    r"|\bthe user\s+(must|should)\s+not\s+(know|see|notice|be told)\b"
    r"|\b(keep|hide)\s+(this|it)\s+(secret|hidden)\b)",
    re.I,
)
_OVERRIDE = re.compile(
    r"(\bignore\s+(all\s+|any\s+)?(previous|prior|above|earlier|other)\s+(instructions|messages|rules|prompts)\b"
    r"|\bdisregard\s+(all\s+|any\s+)?(previous|prior|above|earlier)\b"
    r"|\bsystem\s+prompt\b"
    r"|<\s*/?\s*(important|system|instructions?|admin)\s*>)",
    re.I,
)
_JUDGE = re.compile(
    r"(\b(note|message|instructions?|hint)\s+(to|for)\s+(the\s+|any\s+)?(ai\s+)?(reviewer|auditor|validator|judge|moderator)s?\b"
    r"|\byou\s+are\s+(a|an|the)\s+(security\s+)?(reviewer|auditor|validator|judge)\b"
    r"|\b(classify|mark|rate|label|judge)\s+(this|it|the\s+tool)\s+as\b"
    r"|\bverdict\s+(is|should\s+be|must\s+be|=)\s"
    r"|\b(respond|reply|answer|return|output)\s+(only\s+)?(with\s+)?[\"'{(\[]*\s*verdict\b"
    r"|\b(reviewers?|validators?|judges?|auditors?)\s*:\s)",
    re.I,
)
_CROSS_TOOL = re.compile(
    r"\b(when|before|after|instead of)\s+(using|calling|invoking|running)\s+(the\s+)?[`'\"]?([A-Za-z][A-Za-z0-9_.\-]{2,})",
    re.I,
)
_NOT_TOOL_NAMES = {"this", "that", "these", "those", "any", "other", "another", "tool", "tools", "it", "them", "a", "an"}
_BASE64ISH = re.compile(r"[A-Za-z0-9+/]{120,}={0,2}")
_URL_HOST = re.compile(r"https?://([A-Za-z0-9.-]+)", re.I)
_SIDE_PARAM = re.compile(r"^(notes?|context|side_?note|metadata|meta|extra|debug|comments?|feedback|reasoning)$", re.I)
_FILE_WORDS = re.compile(r"\b(files?|contents?|path|config|configuration|credentials?|keys?|tokens?|env)\b", re.I)

MAX_DESCRIPTION = 2000


def _pictographic(code: int) -> bool:
    """Emoji-capable code points (a deliberately small, deterministic approximation)."""
    return (
        0x1F000 <= code <= 0x1FAFF
        or 0x2600 <= code <= 0x27BF
        or 0x2300 <= code <= 0x23FF
        or 0x2B00 <= code <= 0x2BFF
        or 0x2190 <= code <= 0x21FF
        or 0x25A0 <= code <= 0x25FF
        or code in (0x00A9, 0x00AE, 0x203C, 0x2049, 0x2122, 0x2139, 0x24C2, 0x3030, 0x303D, 0x3297, 0x3299)
    )


def _excused(text: str, index: int) -> bool:
    """True for the two invisible characters that real emoji sequences need, in place:
    a presentation selector right after a pictograph or keycap base, and a zero-width
    joiner between two pictographs (an optional presentation selector may precede it)."""
    code = ord(text[index])
    prev = ord(text[index - 1]) if index > 0 else 0
    if code in _EMOJI_VS:
        return _pictographic(prev) or chr(prev) in "0123456789#*"
    if code == _ZWJ and index + 1 < len(text):
        before = prev
        if before in _EMOJI_VS and index > 1:
            before = ord(text[index - 2])
        return _pictographic(before) and _pictographic(ord(text[index + 1]))
    return False


def _hidden(text: str, index: int) -> bool:
    code = ord(text[index])
    if code in _EMOJI_VS or code == _ZWJ:
        return not _excused(text, index)
    return code in _HIDDEN


def hidden_codepoints(text: str) -> list:
    """Code points of invisible characters, except the joiners and selectors inside real emoji."""
    found = []
    for index, char in enumerate(text):
        code = ord(char)
        if _TAG_FIRST <= code <= _TAG_LAST:
            found.append(code)
        elif _hidden(text, index):
            found.append(code)
    return found


def reveal(text: str) -> str:
    """Make hidden characters visible: runs of tag characters become ``[[HIDDEN: ...]]``
    with their ASCII payload decoded, other invisible characters become ``⟦U+200B⟧``."""
    out, run = [], []

    def flush():
        if run:
            out.append("[[HIDDEN: " + "".join(run) + "]]")
            run.clear()

    for index, char in enumerate(text):
        code = ord(char)
        if _TAG_FIRST <= code <= _TAG_LAST:
            if 0xE0020 <= code <= 0xE007E:
                run.append(chr(code - 0xE0000))
            continue
        flush()
        if _hidden(text, index):
            out.append("⟦U+" + format(code, "04X") + "⟧")
        else:
            out.append(char)
    flush()
    return "".join(out)


def _strings(value) -> list:
    """Every string in a parsed JSON value, object keys included."""
    found = []
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            found.append(item)
        elif isinstance(item, dict):
            for key, child in item.items():
                found.append(str(key))
                stack.append(child)
        elif isinstance(item, list):
            stack.extend(item)
    return found


def _secret_with_verb(text: str) -> bool:
    for match in _SECRET_PLACE.finditer(text):
        window = text[max(0, match.start() - 80): match.end() + 80]
        if _MOVE_VERB.search(window):
            return True
    return False


def _same_site(host: str, server_host: str) -> bool:
    host, server_host = host.lower().rstrip("."), server_host.lower().rstrip(".")
    if not server_host:
        return False
    base = ".".join(server_host.split(".")[-2:])
    return host == server_host or host == base or host.endswith("." + base)


def text_flags(texts: list, own_tools: set, server_host: str) -> set:
    joined = "\n".join(texts)
    codes = set()
    if any(hidden_codepoints(text) for text in texts):
        codes.add("H1")
    if any(_secret_with_verb(reveal(text)) for text in texts):
        codes.add("H2")
    revealed = reveal(joined)
    if _CONCEAL.search(revealed):
        codes.add("H3")
    if _OVERRIDE.search(revealed):
        codes.add("H4")
    if _JUDGE.search(revealed):
        codes.add("H5")
    for match in _CROSS_TOOL.finditer(revealed):
        name = match.group(4).strip(".`'\"")
        if name.lower() not in _NOT_TOOL_NAMES and name not in own_tools:
            codes.add("S1")
    if _BASE64ISH.search(revealed):
        codes.add("S2")
    for host in _URL_HOST.findall(revealed):
        if not _same_site(host, server_host):
            codes.add("S2")
    if _CREDENTIAL.search(revealed):
        codes.add("S4")
    return codes


def tool_flags(tool, own_tools: set, server_host: str) -> list:
    """Sorted flag codes for one parsed tool object."""
    if not isinstance(tool, dict):
        return ["S2"]
    codes = text_flags(_strings(tool), own_tools, server_host)
    description = tool.get("description")
    if isinstance(description, str) and len(description) > MAX_DESCRIPTION:
        codes.add("S2")
    schema = tool.get("inputSchema")
    properties = schema.get("properties") if isinstance(schema, dict) else None
    if isinstance(properties, dict):
        for name, definition in properties.items():
            if _SIDE_PARAM.match(str(name)) and isinstance(definition, dict):
                if _FILE_WORDS.search(reveal(str(definition.get("description", "")))):
                    codes.add("S3")
    return sorted(codes)


def instructions_flags(instructions: str, own_tools: set, server_host: str) -> list:
    if not instructions:
        return []
    codes = text_flags([instructions], own_tools, server_host)
    if len(instructions) > MAX_DESCRIPTION * 2:
        codes.add("S2")
    return sorted(codes)


def has_hard_flag(codes) -> bool:
    return any(str(code).startswith("H") for code in codes)
