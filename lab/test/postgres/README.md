# Validação local do arquivo científico

Em Linux ou macOS, execute os comandos abaixo a partir desta pasta como usuário comum.

```sh
npm ci
npm test
```

O teste inicia um PostgreSQL 18.7 temporário com um socket Unix privado, cria os papéis da aplicação e aplica os dois esquemas do laboratório. Duas sessões independentes exercitam a concorrência. O cluster é encerrado e removido ao fim do teste.
