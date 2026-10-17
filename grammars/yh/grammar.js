module.exports = grammar({
  name: 'yh',
  conflicts: $ => [[$.if_stmt], [$.primary, $.struct_literal], [$.expr]],
  extras: $ => [/\s/, /\/\/[^\n]*/, /\/\*[\s\S]*?\*\//],
  word: $ => $.identifier,

  rules: {
    source_file: $ => repeat($._top_level),

    _top_level: $ => choice(
      $.module_decl,
      $.import_decl,
      $.attribute_group_decl,
      $.pub_decl,
      $.plain_decl,
    ),

    module_decl: $ => seq('module', $.identifier, ';'),

    import_decl: $ => seq('import', $.import_path, optional(seq('as', $.identifier)), ';'),
    import_path: $ => choice(
      seq($.identifier, '.', $.identifier),
      $.identifier,
    ),

    attribute_group_decl: $ => seq($.attribute_group, $._attributed_decl),
    attribute_group: $ => seq('@', '[', commaSep1($.attribute_name), ']'),
    attribute_name: $ => choice($.identifier, 'extern', 'inline'),
    _attributed_decl: $ => choice(
      seq(optional('pub'), $.attributed_fn_decl),
      seq('pub', choice($.struct_decl, $.union_decl, $.enum_decl)),
    ),
    attributed_fn_decl: $ => seq($.fn_signature, choice($.block, ';')),

    pub_decl: $ => seq('pub', $.exported_decl_body),
    exported_decl_body: $ => choice(
      $.const_decl,
      $.fn_decl,
      $.type_decl,
      $.struct_decl,
      $.union_decl,
      $.enum_decl,
    ),

    plain_decl: $ => choice(
      $.let_decl,
      $.const_decl,
      $.fn_decl,
      $.type_decl,
    ),

    let_decl: $ => seq('let', commaSep1($.binding), ';'),
    binding: $ => seq($.identifier, $.type_ref, optional(seq('=', $.expr))),
    const_decl: $ => seq('const', $.identifier, $.type_ref, '=', $.expr, ';'),
    type_decl: $ => seq('type', $.identifier, '=', $.type_ref, ';'),

    fn_decl: $ => seq($.fn_signature, $.block),
    fn_signature: $ => seq('fn', $.identifier, '(', optional($.param_list), ')', optional($.type_ref)),
    param_list: $ => commaSep1($.param),
    param: $ => choice(
      seq($.identifier, '...', $.type_ref),
      seq($.identifier, $.type_ref),
      '...',
    ),

    struct_decl: $ => seq('struct', $.identifier, $.struct_body),
    union_decl: $ => seq('union', $.identifier, $.struct_body),
    enum_decl: $ => seq('enum', $.identifier, $.enum_body),
    struct_body: $ => seq('{', repeat($.field_decl), '}'),
    field_decl: $ => seq($.member_name, $.type_ref, ';'),
    enum_body: $ => seq('{', repeat($.enum_member), '}'),
    enum_member: $ => seq($.member_name, optional(seq('=', $.expr)), ';'),
    // fix below

    type_ref: $ => choice(
      $.function_type,
      $.pointer_type,
      $.array_type,
      $.slice_type,
      $.named_type,
    ),
    function_type: $ => seq('fn', '(', optional($.type_list), ')', $.type_ref),
    pointer_type: $ => seq('*', $.type_ref),
    array_type: $ => seq('[', $.expr, ']', $.type_ref),
    slice_type: $ => seq('[', ']', $.type_ref),
    named_type: $ => seq($.identifier, optional($.type_args)),
    type_args: $ => seq('<', commaSep1($.type_ref), '>'),
    type_list: $ => commaSep1($.type_ref),

    block: $ => seq('{', repeat($._stmt), '}'),
    _stmt: $ => choice(
      $.let_decl,
      $.const_decl,
      $.type_decl,
      $.return_stmt,
      $.break_stmt,
      $.continue_stmt,
      $.goto_stmt,
      $.if_stmt,
      $.for_stmt,
      $.switch_stmt,
      $.labeled_stmt,
      $.expr_stmt,
      $.block,
    ),
    return_stmt: $ => seq('return', optional($.expr), ';'),
    break_stmt: $ => seq('break', ';'),
    continue_stmt: $ => seq('continue', ';'),
    goto_stmt: $ => seq('goto', $.identifier, ';'),
    labeled_stmt: $ => seq($.identifier, ':', $._stmt),
    expr_stmt: $ => seq($.expr, ';'),
    if_stmt: $ => seq('if', '(', $.expr, ')', $._stmt, optional(seq('else', $._stmt))),
    for_stmt: $ => choice(
      seq('for', $.identifier, optional(seq(',', $.identifier)), 'in', $.expr, $.block),
      seq('for', optional($.for_init), ';', optional($.expr), ';', optional($.expr), $.block),
      seq('for', $.expr, $.block),
    ),
    for_init: $ => choice($.let_decl_no_semi, $.expr),
    let_decl_no_semi: $ => seq('let', commaSep1($.binding)),
    switch_stmt: $ => seq('switch', $.expr, '{', repeat($.case_clause), optional($.default_clause), '}'),
    case_clause: $ => seq('case', commaSep1($.expr), $.block),
    default_clause: $ => seq('default', $.block),

    expr: $ => seq($.primary, repeat(choice(
      seq(choice('=', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<', '>', '<=', '>=', '&&', '||', '&', '|', '^', '<<', '>>', '+', '-', '*', '/', '%'), $.primary),
      seq('?', $.expr, ':', $.expr),
      seq('.', $.member_name),
      seq('[', $.expr, optional(seq('..', $.expr)), ']'),
      seq('(', optional($.arg_list), ')'),
      seq('.to_type', '(', $.type_ref, ')'),
    ))),
    arg_list: $ => commaSep1($.expr),

    primary: $ => choice(
      $.number,
      $.string,
      $.char,
      $.bool,
      $.nil,
      $.identifier,
      seq('(', $.expr, ')'),
      $.struct_literal,
      $.array_literal,
    ),
    struct_literal: $ => seq($.identifier, '{', optional(commaSep1($.field_init)), '}'),
    field_init: $ => choice(
      seq($.member_name, ':', $.expr),
      $.expr,
    ),
    array_literal: $ => seq('[', optional(commaSep1($.expr)), ']'),

    member_name: $ => $.identifier,
    identifier: $ => /[A-Za-z_][A-Za-z0-9_]*/,
    number: $ => /(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:[ui](?:8|16|32|64))?/,
    string: $ => /"(?:[^"\\]|\\.)*"/,
    char: $ => /'(?:[^'\\]|\\.)*'/,
    bool: $ => choice('true', 'false'),
    nil: $ => 'nil',
  }
});

function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}
