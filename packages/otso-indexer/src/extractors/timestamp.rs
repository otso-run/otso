use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};

/// Parse a timestamp string into a Unix timestamp
/// Supports multiple formats found in Chronicle sources
pub fn parse_timestamp(s: &str) -> Option<i64> {
    let s = s.trim();

    if s.is_empty() {
        return None;
    }

    // Try parsing as Unix timestamp (integer)
    if let Ok(ts) = s.parse::<i64>() {
        return validate_timestamp(ts);
    }

    // Try parsing as Unix timestamp (float)
    if let Ok(ts) = s.parse::<f64>() {
        return validate_timestamp(ts as i64);
    }

    // ISO 8601 with timezone (2024-01-15T10:30:00Z)
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp());
    }

    // ISO 8601 variants
    for fmt in &[
        "%Y-%m-%dT%H:%M:%S%.f%:z", // With fractional seconds and timezone
        "%Y-%m-%dT%H:%M:%S%:z",    // Without fractional
        "%Y-%m-%dT%H:%M:%S%.fZ",   // UTC with fractional
        "%Y-%m-%dT%H:%M:%SZ",      // UTC without fractional
        "%Y-%m-%dT%H:%M:%S",       // No timezone
        "%Y-%m-%d %H:%M:%S%.f",    // Space separator with fractional
        "%Y-%m-%d %H:%M:%S",       // Space separator
        "%Y-%m-%d",                // Date only
    ] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(Utc.from_utc_datetime(&dt).timestamp());
        }
    }

    // RFC 2822 (email format: "Mon, 15 Jan 2024 10:30:00 +0000")
    if let Ok(dt) = DateTime::parse_from_rfc2822(s) {
        return Some(dt.timestamp());
    }

    // Twitter archive format: "Fri Oct 11 03:24:39 +0000 2024"
    if let Ok(dt) = DateTime::parse_from_str(s, "%a %b %d %H:%M:%S %z %Y") {
        return Some(dt.timestamp());
    }

    // Common date formats
    for fmt in &[
        "%b %d, %Y %H:%M:%S",      // "Jan 15, 2024 10:30:00"
        "%B %d, %Y %H:%M:%S",      // "January 15, 2024 10:30:00"
        "%b %d, %Y",               // "Jan 15, 2024"
        "%B %d, %Y",               // "January 15, 2024"
        "%m/%d/%Y %H:%M:%S",       // "01/15/2024 10:30:00"
        "%m/%d/%Y",                // "01/15/2024"
        "%d/%m/%Y %H:%M:%S",       // "15/01/2024 10:30:00" (European)
        "%d/%m/%Y",                // "15/01/2024"
        "%Y/%m/%d %H:%M:%S",       // "2024/01/15 10:30:00"
        "%Y/%m/%d",                // "2024/01/15"
    ] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(Utc.from_utc_datetime(&dt).timestamp());
        }
        // Try as date-only format
        if let Ok(date) = chrono::NaiveDate::parse_from_str(s, fmt) {
            return Some(
                Utc.from_utc_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
                    .timestamp(),
            );
        }
    }

    // Apple Core Data timestamp (seconds since Jan 1, 2001)
    // Commonly found in Apple app exports
    if let Ok(apple_ts) = s.parse::<f64>() {
        let unix_ts = apple_ts + 978307200.0; // Offset to Unix epoch
        let ts = unix_ts as i64;
        if ts > 978307200 && ts < 4102444800 {
            return Some(ts);
        }
    }

    // Milliseconds since epoch (common in JavaScript)
    if let Ok(ms) = s.parse::<i64>() {
        if ms > 1000000000000 && ms < 4102444800000 {
            return Some(ms / 1000);
        }
    }

    tracing::warn!("Failed to parse timestamp: {}", s);
    None
}

/// Validate that a timestamp is in a reasonable range (1970-2100)
fn validate_timestamp(ts: i64) -> Option<i64> {
    // Handle milliseconds
    if ts > 1000000000000 && ts < 4102444800000 {
        return Some(ts / 1000);
    }

    // Valid Unix timestamp range
    if ts > 0 && ts < 4102444800 {
        return Some(ts);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_iso8601() {
        assert!(parse_timestamp("2024-01-15T10:30:00Z").is_some());
        assert!(parse_timestamp("2024-01-15T10:30:00+00:00").is_some());
        assert!(parse_timestamp("2024-01-15T10:30:00.123Z").is_some());
    }

    #[test]
    fn test_parse_unix() {
        assert_eq!(parse_timestamp("1705315800"), Some(1705315800));
        assert_eq!(parse_timestamp("1705315800000"), Some(1705315800)); // Milliseconds
    }

    #[test]
    fn test_parse_date_only() {
        assert!(parse_timestamp("2024-01-15").is_some());
    }

    #[test]
    fn test_parse_rfc2822() {
        assert!(parse_timestamp("Mon, 15 Jan 2024 10:30:00 +0000").is_some());
    }

    #[test]
    fn test_invalid() {
        assert!(parse_timestamp("").is_none());
        assert!(parse_timestamp("not a date").is_none());
        assert!(parse_timestamp("-1").is_none());
    }
}
