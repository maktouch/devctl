use devctl::caddy::{derive_config_name, extract_hostnames};

// deriveConfigName

#[test]
fn returns_the_hostname_of_a_simple_site_block() {
    assert_eq!(
        derive_config_name("myapp.localhost {\n\treverse_proxy :3000\n}\n"),
        Some("myapp.localhost".to_string())
    );
}

#[test]
fn strips_protocol_port_and_path_from_the_address() {
    assert_eq!(
        derive_config_name("https://api.test:8443/v1 {\n}\n"),
        Some("api.test".to_string())
    );
}

#[test]
fn takes_the_first_address_when_several_share_a_block() {
    assert_eq!(
        derive_config_name("a.test, b.test {\n}\n"),
        Some("a.test".to_string())
    );
}

#[test]
fn skips_comments_and_blank_lines_before_the_site_address() {
    assert_eq!(
        derive_config_name("# managed by devctl\n\nsite.test {\n}\n"),
        Some("site.test".to_string())
    );
}

#[test]
fn skips_snippet_definitions() {
    let content = "(common) {\n\tencode gzip\n}\n\nreal.test {\n\timport common\n}\n";
    assert_eq!(derive_config_name(content), Some("real.test".to_string()));
}

#[test]
fn ignores_braces_nested_inside_a_block() {
    let content = "outer.test {\n\thandle {\n\t\trespond \"inner.test {\"\n\t}\n}\n";
    assert_eq!(derive_config_name(content), Some("outer.test".to_string()));
}

#[test]
fn rejects_wildcard_and_port_only_addresses() {
    assert_eq!(derive_config_name("* {\n}\n"), None);
    assert_eq!(derive_config_name(":8080 {\n}\n"), None);
}

#[test]
fn returns_none_when_no_site_address_exists() {
    assert_eq!(derive_config_name("# just a comment\n"), None);
    assert_eq!(derive_config_name(""), None);
}

// extractHostnames

#[test]
fn collects_every_address_of_a_shared_block() {
    assert_eq!(
        extract_hostnames("a.test, b.test {\n\treverse_proxy :3000\n}\n"),
        vec!["a.test", "b.test"]
    );
}

#[test]
fn collects_addresses_across_multiple_site_blocks() {
    let content = "one.test {\n\trespond \"1\"\n}\n\ntwo.test {\n\trespond \"2\"\n}\n";
    assert_eq!(extract_hostnames(content), vec!["one.test", "two.test"]);
}

#[test]
fn deduplicates_repeated_hostnames() {
    let content = "dup.test {\n}\nhttp://dup.test:8080 {\n}\n";
    assert_eq!(extract_hostnames(content), vec!["dup.test"]);
}

#[test]
fn ignores_wildcards_port_only_addresses_and_snippets() {
    let content = "(snippet) {\n}\n* {\n}\n:9999 {\n}\nkeep.test {\n}\n";
    assert_eq!(extract_hostnames(content), vec!["keep.test"]);
}

#[test]
fn returns_an_empty_list_for_content_without_site_blocks() {
    assert_eq!(extract_hostnames("# nothing here\n"), Vec::<String>::new());
}
