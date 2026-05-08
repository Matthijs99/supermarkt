# Supermarkt prijsvergelijker

Zoek een product en zie per supermarkt de goedkoopste optie, gesorteerd op eenheidsprijs.

## Functionaliteit

- Fuzzy zoeken met negatieve termen (bijv. `chips -paprika`)
- Eenheidsprijs per 100g / 100ml / stuk
- Grootte-filter (min–max)
- Supermarktfilter (ketens aan/uit)
- Directe links naar productpagina's

## Lokaal draaien

Vereist een HTTP-server vanwege CORS:

```bash
python -m http.server 8000
```

Open daarna `http://localhost:8000`.

## Databron

Productdata wordt opgehaald van [checkjebon.nl](https://www.checkjebon.nl).
