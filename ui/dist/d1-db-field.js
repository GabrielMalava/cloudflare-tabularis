var __tabularis_plugin__ = (function (jsx, api) {
  "use strict";
  var DRIVER = "tubularis-d1";
  return api
    .defineSlot("connection-modal.connection_content", function (props) {
      var ctx = props.context;
      if (ctx.driver !== DRIVER) return null;
      var value = typeof ctx.database === "string" ? ctx.database : "";
      var onChange = ctx.onDatabaseChange || function () {};
      return jsx.jsxs("div", {
        style: { display: "flex", flexDirection: "column", gap: "4px" },
        children: [
          jsx.jsx("label", {
            style: {
              fontSize: "10px",
              textTransform: "uppercase",
              fontWeight: 600,
              letterSpacing: "0.05em",
              color: "var(--color-text-muted, #94a3b8)",
            },
            children: "D1 Database (name or ID)",
          }),
          jsx.jsx("input", {
            type: "text",
            value: value,
            onChange: function (e) {
              onChange(e.target.value);
            },
            autoCorrect: "off",
            autoCapitalize: "off",
            autoComplete: "off",
            spellCheck: false,
            placeholder: "e.g. my-database or a database UUID",
            style: {
              width: "100%",
              padding: "7px 10px",
              background: "var(--color-bg-base, #131929)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "6px",
              color: "var(--color-text-primary, #e2e8f0)",
              fontSize: "13px",
              outline: "none",
              boxSizing: "border-box",
            },
          }),
          jsx.jsx("p", {
            style: {
              fontSize: "11px",
              color: "var(--color-text-muted, #94a3b8)",
              marginTop: "2px",
            },
            children:
              "Account ID and API token are set in this plugin's Settings (gear icon).",
          }),
        ],
      });
    })
    .component;
})(ReactJSXRuntime, __TABULARIS_API__);
