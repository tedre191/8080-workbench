; Hello, 8080!
; Prints a greeting on the terminal, then echoes whatever you type.
; The terminal is a 6850-style serial port: status at 10h, data at 11h.

STATUS  EQU 10h
DATA    EQU 11h
RXRDY   EQU 01h             ; status bit 0: a key is waiting

        ORG 0
start:  LXI SP, 0E000h
        LXI H, greeting
        CALL puts

echo:   IN STATUS           ; wait for a key
        ANI RXRDY
        JZ echo
        IN DATA
        CPI 13              ; turn Enter into a newline
        JNZ send
        MVI A, 10
send:   OUT DATA
        JMP echo

; Print the zero-terminated string at HL.
puts:   MOV A, M
        ORA A
        RZ
        OUT DATA
        INX H
        JMP puts

greeting:
        DB "Hello, 8080!", 10
        DB "Type something: ", 0
