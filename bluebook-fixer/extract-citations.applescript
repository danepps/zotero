tell application "Microsoft Word"
    set fieldList to ""
    set doc to active document
    set bodyFieldCount to count fields of text object of doc
    repeat with i from 1 to bodyFieldCount
        set f to field i of text object of doc
        set fc to content of field code of f
        if fc contains "ZOTERO_ITEM" then
            set fieldList to fieldList & fc & "\n---\n"
        end if
    end repeat
    set fnoteCount to count footnotes of doc
    repeat with fi from 1 to fnoteCount
        set fn to footnote fi of doc
        set fnFieldCount to count fields of text object of fn
        repeat with i from 1 to fnFieldCount
            set f to field i of text object of fn
            set fc to content of field code of f
            if fc contains "ZOTERO_ITEM" then
                set fieldList to fieldList & fc & "\n---\n"
            end if
        end repeat
    end repeat
    return fieldList
end tell
