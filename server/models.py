"""Typed request models shared by the versioned API."""
from __future__ import annotations

from typing import Annotated, Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator


PathName = Literal["recruiter", "viewer", "friend", "personal"]
BlogPrimaryTag = Literal["work", "thoughts", "dreams", "friends", "travel", "life"]
LayoutPreset = Literal["upper", "lower", "feature", "media-left", "media-right"]


def safe_plain_text(value: str, *, allow_newlines: bool = True) -> str:
    value = value.strip()
    if "<" in value or ">" in value or "\x00" in value:
        raise ValueError("HTML and NUL characters are not allowed")
    if not allow_newlines and any(char in value for char in "\r\n"):
        raise ValueError("line breaks are not allowed")
    return value


def safe_http_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("URL must be an absolute http or https URL without credentials")
    return value.strip()


def validate_document_urls(value: Any, key: str = "") -> None:
    """Reject active/ambiguous URL schemes anywhere in editable documents."""
    if isinstance(value, dict):
        for child_key, child in value.items():
            validate_document_urls(child, str(child_key))
        return
    if isinstance(value, list):
        for child in value:
            validate_document_urls(child, key)
        return
    if not isinstance(value, str) or not value.strip():
        return
    url_keys = {"url", "href", "cal_link", "booking_url", "canonical_url", "source", "license_url", "author_url"}
    if key not in url_keys and not key.endswith("_url"):
        return
    candidate = value.strip()
    if candidate.startswith("/") and not candidate.startswith("//"):
        return
    safe_http_url(candidate)


class PostLink(BaseModel):
    kind: Literal["post"]
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)


class ExternalLink(BaseModel):
    kind: Literal["external"]
    label: str = Field(min_length=1, max_length=80)
    url: str = Field(max_length=2048)

    @field_validator("url")
    @classmethod
    def url_is_safe(cls, value: str) -> str:
        return safe_http_url(value)

    @field_validator("label")
    @classmethod
    def label_is_not_blank(cls, value: str) -> str:
        value = safe_plain_text(value, allow_newlines=False)
        if not value:
            raise ValueError("link label cannot be blank")
        return value


TimelineLink = Annotated[PostLink | ExternalLink, Field(discriminator="kind")]
LINK_ADAPTER = TypeAdapter(list[TimelineLink])


class TimelinePeriodIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    sort_order: int = Field(default=0, ge=-10000, le=10000)
    published: bool = True

    @field_validator("label")
    @classmethod
    def plain_label(cls, value: str) -> str:
        value = safe_plain_text(value, allow_newlines=False)
        if not value:
            raise ValueError("period label cannot be blank")
        return value


class TimelineEventIn(BaseModel):
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    category: str = Field(default="story", min_length=1, max_length=40, pattern=r"^[a-z0-9-]+$")
    title: str = Field(min_length=1, max_length=200)
    subtitle: str = Field(default="", max_length=200)
    summary: str = Field(default="", max_length=2000)
    details_md: str = Field(default="", max_length=16000)
    layout: LayoutPreset = "feature"
    accent: str = Field(default="blue", pattern=r"^[a-z0-9-]{1,32}$")
    media_id: int | None = Field(default=None, ge=1)
    alt_text: str = Field(default="", max_length=300)
    links: list[TimelineLink] = Field(default_factory=list, max_length=12)
    sort_order: int = Field(default=0, ge=-10000, le=10000)
    published: bool = True

    @field_validator("title", "subtitle", "summary", "alt_text")
    @classmethod
    def plain_fields(cls, value: str) -> str:
        value = safe_plain_text(value)
        return value

    @model_validator(mode="after")
    def title_is_not_blank(self):
        if not self.title:
            raise ValueError("event title cannot be blank")
        return self

class TimelineOrderIn(BaseModel):
    period_ids: list[int] = Field(default_factory=list, max_length=500)
    event_ids_by_period: dict[int, list[int]] = Field(default_factory=dict)


class ContentWrite(BaseModel):
    data: dict[str, Any] | list[Any]
    published: bool = False
    note: str = Field(default="", max_length=300)


class EditableDocument(BaseModel):
    """Base for structured CMS documents while permitting future fields."""

    model_config = ConfigDict(extra="allow")


class SiteDocument(EditableDocument):
    site_title: str = Field(default="", max_length=160)
    canonical_url: str = Field(default="", max_length=2048)
    owner_name: str = Field(default="", max_length=160)
    owner_contact: str = Field(default="", max_length=320)
    booking_url: str = Field(default="", max_length=2048)
    hosting_provider: str = Field(default="", max_length=300)
    friend_story_consent_confirmed: bool = False

    @field_validator("canonical_url", "booking_url")
    @classmethod
    def optional_http_url(cls, value: str) -> str:
        return safe_http_url(value) if value.strip() else ""


class RecommendationDocument(EditableDocument):
    q: str = Field(default="", max_length=2000)
    a: str = Field(default="", max_length=300)


class SelectedWorkDocument(EditableDocument):
    num: str = Field(default="", max_length=40)
    title: str = Field(default="", max_length=200)
    sub: str = Field(default="", max_length=500)
    stat: str = Field(default="", max_length=200)
    year: str = Field(default="", max_length=80)


class CareerDocument(EditableDocument):
    year: str = Field(default="", max_length=80)
    role: str = Field(default="", max_length=200)
    co: str = Field(default="", max_length=200)
    desc: str = Field(default="", max_length=3000)


class CardDocument(EditableDocument):
    name: str = Field(default="", max_length=200)
    role: str = Field(default="", max_length=200)
    status: str = Field(default="", max_length=200)
    updated: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=320)
    phone: str = Field(default="", max_length=80)
    phone_display: str = Field(default="", max_length=80)
    url: str = Field(default="", max_length=2048)
    cal_link: str = Field(default="", max_length=2048)
    github_url: str = Field(default="", max_length=2048)
    linkedin_url: str = Field(default="", max_length=2048)
    tagline: str = Field(default="", max_length=1000)
    footer: str = Field(default="", max_length=300)
    chips: list[str] = Field(default_factory=list, max_length=30)
    logos: list[str] = Field(default_factory=list, max_length=30)
    recs: list[RecommendationDocument] = Field(default_factory=list, max_length=30)
    selected_work: list[SelectedWorkDocument] = Field(default_factory=list, max_length=100)
    career: list[CareerDocument] = Field(default_factory=list, max_length=100)

    @field_validator("url", "cal_link", "github_url", "linkedin_url")
    @classmethod
    def optional_http_url(cls, value: str) -> str:
        return safe_http_url(value) if value.strip() else ""


class ResumeIdentityDocument(EditableDocument):
    name: str = Field(default="", max_length=200)
    headline: str = Field(default="", max_length=300)


class ResumeContactDocument(EditableDocument):
    label: str = Field(default="", max_length=100)
    value: str = Field(default="", max_length=500)


class ResumeEntryDocument(EditableDocument):
    role: str = Field(default="", max_length=240)
    co: str = Field(default="", max_length=240)
    dates: str = Field(default="", max_length=120)
    desc: str = Field(default="", max_length=6000)


class ResumeProjectDocument(EditableDocument):
    title: str = Field(default="", max_length=240)
    desc: str = Field(default="", max_length=6000)


class ResumeDocument(EditableDocument):
    name: str = Field(default="", max_length=200)
    headline: str = Field(default="", max_length=300)
    stub: str = Field(default="", max_length=1000)
    summary: str = Field(default="", max_length=10000)
    identity: ResumeIdentityDocument | None = None
    contact: list[ResumeContactDocument] = Field(default_factory=list, max_length=40)
    experience: list[ResumeEntryDocument] = Field(default_factory=list, max_length=100)
    education: list[ResumeEntryDocument] = Field(default_factory=list, max_length=100)
    projects: list[ResumeProjectDocument] = Field(default_factory=list, max_length=100)
    notable: list[ResumeProjectDocument] = Field(default_factory=list, max_length=100)
    skills: list[str] = Field(default_factory=list, max_length=200)


class FriendLinkDocument(EditableDocument):
    icon: str = Field(default="", max_length=20)
    label: str = Field(default="", max_length=120)
    href: str = Field(default="", max_length=2048)

    @field_validator("href")
    @classmethod
    def optional_http_url(cls, value: str) -> str:
        return safe_http_url(value) if value.strip() else ""


class LegalDocument(EditableDocument):
    controller_name: str = Field(default="", max_length=500)
    controller_contact: str = Field(default="", max_length=500)
    purpose: str = Field(default="", max_length=10000)
    lawful_basis: str = Field(default="", max_length=10000)
    processor_hosting: str = Field(default="", max_length=10000)
    international_transfers: str = Field(default="", max_length=10000)
    retention: str = Field(default="", max_length=10000)
    rights: str = Field(default="", max_length=10000)
    withdrawal: str = Field(default="", max_length=10000)
    complaint_authority: str = Field(default="", max_length=10000)
    cookie_details: str = Field(default="", max_length=10000)
    terms: str = Field(default="", max_length=10000)
    last_updated: str = Field(default="", max_length=40)


CONTENT_DOCUMENT_ADAPTERS: dict[str, TypeAdapter[Any]] = {
    "site": TypeAdapter(SiteDocument),
    "card": TypeAdapter(CardDocument),
    "resume": TypeAdapter(ResumeDocument),
    "selected_work": TypeAdapter(list[SelectedWorkDocument]),
    "career": TypeAdapter(list[CareerDocument]),
    "friend_links": TypeAdapter(list[FriendLinkDocument]),
    "legal": TypeAdapter(LegalDocument),
}


def validate_content_document(key: str, data: Any) -> None:
    """Apply the strongest known schema without discarding forward fields."""

    adapter = CONTENT_DOCUMENT_ADAPTERS.get(key)
    if adapter is not None:
        adapter.validate_python(data)
    elif not isinstance(data, (dict, list)):
        raise ValueError("content must be an object or list")
    validate_document_urls(data)


class PostIn(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    title: str = Field(min_length=1, max_length=200)
    body_md: str = Field(default="", max_length=60000)
    excerpt: str = Field(default="", max_length=500)
    # Path tags decide which in-world scrolls surface a post. The editorial
    # primary/secondary tags power the standalone writing archive.
    tags: list[PathName] = Field(default_factory=list, max_length=4)
    primary_tag: BlogPrimaryTag = "thoughts"
    secondary_tags: list[str] = Field(default_factory=list, max_length=12)
    series: str = Field(default="", max_length=100)
    created_at: str | None = Field(default=None, max_length=40)
    published: bool = False

    @field_validator("title", "excerpt")
    @classmethod
    def plain_fields(cls, value: str) -> str:
        return safe_plain_text(value)

    @model_validator(mode="after")
    def title_is_not_blank(self):
        if not self.title:
            raise ValueError("post title cannot be blank")
        return self

    @field_validator("secondary_tags")
    @classmethod
    def clean_secondary_tags(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            tag = safe_plain_text(str(value), allow_newlines=False).strip().lower()
            tag = "-".join(tag.split())
            if not tag or len(tag) > 40 or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789-" for char in tag):
                raise ValueError("secondary tags may contain lowercase letters, numbers, spaces, and hyphens")
            if tag not in cleaned:
                cleaned.append(tag)
        return cleaned

    @field_validator("series")
    @classmethod
    def clean_series(cls, value: str) -> str:
        return safe_plain_text(value, allow_newlines=False)


class CommentIn(BaseModel):
    author_name: str = Field(default="anonymous", max_length=60)
    body: str = Field(min_length=1, max_length=4000)
    parent_id: int | None = Field(default=None, ge=1)
    website: str = Field(default="", max_length=500, exclude=True)

    @field_validator("author_name", "body")
    @classmethod
    def plain_fields(cls, value: str) -> str:
        return safe_plain_text(value)

    @model_validator(mode="after")
    def body_is_not_blank(self):
        if not self.body:
            raise ValueError("comment body cannot be blank")
        return self


class CommentModerationIn(BaseModel):
    hidden: bool


class ReactionIn(BaseModel):
    emoji: Literal["👍", "😂", "🤯", "✨", "🔥"]


class MessageIn(BaseModel):
    path: PathName
    author_name: str = Field(default="anonymous", max_length=60)
    contact: str = Field(default="", max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    publication_consent: bool = False
    consent_version: str | None = Field(default=None, max_length=40)
    website: str = Field(default="", max_length=500, exclude=True)

    @field_validator("author_name", "contact", "body")
    @classmethod
    def plain_fields(cls, value: str) -> str:
        return safe_plain_text(value)

    @model_validator(mode="after")
    def consent_has_version(self):
        if not self.body:
            raise ValueError("message body cannot be blank")
        if self.publication_consent and not self.consent_version:
            raise ValueError("consent_version is required when publication consent is given")
        return self


class MessageModerationIn(BaseModel):
    status: Literal["pending", "approved", "rejected"]
    publish: bool = False
    public_display_name: str = Field(default="", max_length=60)

    @field_validator("public_display_name")
    @classmethod
    def plain_name(cls, value: str) -> str:
        return safe_plain_text(value)


class StatEventIn(BaseModel):
    type: Literal["view", "path_enter", "resume_open", "share", "vcard", "stats_open", "chat_book", "booking_click", "card_flip"]
    path: str = Field(default="", max_length=24)
    session_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,100}$")
    event_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,100}$")
    landing_referrer: str = Field(default="", max_length=2048)
    device_class: Literal["desktop", "tablet", "mobile", "other"] = "other"
    browser_family: Literal["Chrome", "Edge", "Firefox", "Safari", "Other"] = "Other"
    language: str = Field(default="other", pattern=r"^[a-z]{2,3}$|^other$", max_length=5)
    timezone_region: Literal["Africa", "Americas", "Asia", "Europe", "Oceania", "Other"] = "Other"

    @field_validator("path")
    @classmethod
    def valid_path(cls, value: str) -> str:
        if value and value not in {"world", "recruiter", "viewer", "friend", "personal"}:
            raise ValueError("unknown path")
        return value


class LegalSettingsIn(BaseModel):
    values: dict[str, str]

    @field_validator("values")
    @classmethod
    def bounded_values(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 30:
            raise ValueError("too many legal settings")
        for key, item in value.items():
            if len(key) > 60 or len(item) > 10000:
                raise ValueError("legal setting is too large")
        return value
