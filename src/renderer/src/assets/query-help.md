# Справочник по синтаксису Elasticsearch Query DSL

Ниже приведены наиболее часто используемые конструкции запросов и примеры.

---

## match_all

Возвращает все документы. Полезен, когда нужно применить только фильтр или получить выборку без ограничений по содержимому.

```json
{
  "query": {
    "match_all": {}
  }
}
```

---

## match

Полнотекстовый поиск по полю. Текст анализируется (токенизируется, приводится к нижнему регистру) и ищется по инвертированному индексу.

```json
{
  "query": {
    "match": {
      "title": "quick brown fox"
    }
  }
}
```

По умолчанию оператор `OR`. Чтобы искать все слова, укажите `and`:

```json
{
  "query": {
    "match": {
      "title": {
        "query": "quick brown fox",
        "operator": "and"
      }
    }
  }
}
```

---

## match_phrase

Ищет точную фразу с учётом порядка слов. Токены должны идти подряд.

```json
{
  "query": {
    "match_phrase": {
      "title": "quick brown"
    }
  }
}
```

Можно добавить `slop` — допустимое расстояние между словами:

```json
{
  "query": {
    "match_phrase": {
      "title": {
        "query": "quick fox",
        "slop": 1
      }
    }
  }
}
```

---

## term

Точное совпадение значения в поле. Не применяет анализатор: значение сравнивается с инвертированным индексом «как есть».

```json
{
  "query": {
    "term": {
      "status": "published"
    }
  }
}
```

> **Важно:** для `text`-полей, прошедших анализ (при индексации), `term` может не найти значение, потому что в индексе лежат токены в нижнем регистре.

---

## terms

Точное совпадение с одним из значений из списка (OR):

```json
{
  "query": {
    "terms": {
      "status": ["published", "draft"]
    }
  }
}
```

---

## range

Диапазонные фильтры по числам, датам или строкам.

| Оператор | Значение           |
|----------|--------------------|
| `gt`     | больше             |
| `gte`    | больше или равно   |
| `lt`     | меньше             |
| `lte`    | меньше или равно   |

```json
{
  "query": {
    "range": {
      "age": {
        "gte": 18,
        "lte": 65
      }
    }
  }
}
```

Фильтр по дате (relative):

```json
{
  "query": {
    "range": {
      "@timestamp": {
        "gte": "now-7d/d",
        "lt": "now/d"
      }
    }
  }
}
```

---

## bool

Комбинирование нескольких запросов. Содержит четыре секции:

- **`must`** — обязательные условия (участвуют в подсчёте `_score`)
- **`should`** — хотя бы одно должно совпасть (можно задать `minimum_should_match`)
- **`must_not`** — исключающие условия
- **`filter`** — обязательные условия без влияния на `_score`

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "search" } }
      ],
      "filter": [
        { "term": { "status": "published" } },
        { "range": { "created_at": { "gte": "2024-01-01" } } }
      ],
      "must_not": [
        { "match": { "hidden": true } }
      ]
    }
  }
}
```

---

## exists

Проверка наличия (или отсутствия) значения в поле.

```json
{
  "query": {
    "exists": {
      "field": "title"
    }
  }
}
```

Проверка отсутствия поля (обёрнуто в `bool` + `must_not`):

```json
{
  "query": {
    "bool": {
      "must_not": {
        "exists": {
          "field": "deleted_at"
        }
      }
    }
  }
}
```

---

## wildcard

Поиск по шаблону с `*` (любая последовательность) и `?` (один символ).

```json
{
  "query": {
    "wildcard": {
      "user": "ki*y"
    }
  }
}
```

> Шаблоны тяжёлые на выполнение — старайтесь не ставить `*` в начало строки.

---

## ids

Выборка документов по идентификаторам `_id`.

```json
{
  "query": {
    "ids": {
      "values": ["1", "4", "100"]
    }
  }
}
```

---

## prefix

Поиск по префиксу.

```json
{
  "query": {
    "prefix": {
      "user": "john"
    }
  }
}
```

---

## multi_match

Поиск по нескольким полям одновременно.

```json
{
  "query": {
    "multi_match": {
      "query": "quick brown",
      "fields": ["title^3", "description", "tags"]
    }
  }
}
```

`^3` у поля `title` повышает его вес (boost) в три раза.

---

## query_string

Мощный синтаксический запрос с поддержкой логики (`AND`, `OR`, `NOT`), подстановок и полей.

```json
{
  "query": {
    "query_string": {
      "query": "(quick OR brown) AND fox",
      "fields": ["title", "content"]
    }
  }
}
```

> Будьте осторожны: синтаксис query_string строгий — незакрытая скобка или кавычка вызовет ошибку.

---

## nested

Запросы по вложенным (`nested`) объектам. Без `nested` ES «смешивает» поля вложенных документов.

```json
{
  "query": {
    "nested": {
      "path": "comments",
      "query": {
        "bool": {
          "must": [
            { "match": { "comments.author": "john" } },
            { "match": { "comments.text": "thanks" } }
          ]
        }
      }
    }
  }
}
```

---

## script

Запрос на основе скрипта Painless.

```json
{
  "query": {
    "script": {
      "script": {
        "source": "doc['age'].value >= params.min_age",
        "params": {
          "min_age": 18
        }
      }
    }
  }
}
```

---

## Агрегации

### terms

Группировка по уникальным значениям поля:

```json
{
  "aggs": {
    "by_status": {
      "terms": {
        "field": "status"
      }
    }
  }
}
```

### date_histogram

Группировка по временным интервалам:

```json
{
  "aggs": {
    "over_time": {
      "date_histogram": {
        "field": "@timestamp",
        "calendar_interval": "1h"
      }
    }
  }
}
```

### Метрические агрегации

```json
{
  "aggs": {
    "avg_price": { "avg": { "field": "price" } },
    "max_price": { "max": { "field": "price" } },
    "min_price": { "min": { "field": "price" } },
    "sum_price": { "sum": { "field": "price" } }
  }
}
```

### cardinality

Подсчёт уникальных значений:

```json
{
  "aggs": {
    "unique_ips": {
      "cardinality": {
        "field": "ip"
      }
    }
  }
}
```

---

## Пакетный поиск (_msearch)

Кнопка **Msearch** выполняет несколько поисковых запросов одним запросом к Elasticsearch/OpenSearch. В редакторе используйте формат NDJSON: для каждого поиска укажите две отдельные строки — заголовок и тело запроса. Повторяйте эту пару для каждого следующего поиска.

- **Заголовок** — JSON-объект с параметрами конкретного поиска. Укажите `{}`, если параметры не нужны. В заголовке можно задать, например, индекс через `index`.
- **Тело** — обычное тело поиска с параметрами верхнего уровня `query`, `size`, `sort`, `aggs` и другими. Например, `{"query": {...}, "size": 10}`; не добавляйте ещё одну внешнюю обёртку `"query"`.
- Каждая строка должна содержать один JSON-объект. Не оборачивайте строки в массив и не разделяйте пары запятыми.
- Поле индекса над редактором задаёт индекс по умолчанию для запроса; заголовок пары позволяет указать индекс для отдельного поиска.

Пример двух поисков: сначала по `logs-*`, затем по `products`:

```ndjson
{"index":"logs-*"}
{"size":10,"query":{"match":{"message":"connection timeout"}}}
{"index":"products"}
{"size":5,"query":{"match":{"name":"laptop"}}}
```

Для одного поиска можно использовать такой же формат с одной парой строк:

```ndjson
{}
{"query":{"bool":{"filter":[{"term":{"status":"published"}}]}}}
```

---

## Полный пример

```json
{
  "size": 0,
  "query": {
    "bool": {
      "filter": [
        { "range": { "@timestamp": { "gte": "now-24h" } } },
        { "term": { "status": "error" } }
      ]
    }
  },
  "aggs": {
    "by_service": {
      "terms": {
        "field": "service.name",
        "size": 10
      },
      "aggs": {
        "avg_latency": {
          "avg": { "field": "latency_ms" }
        }
      }
    }
  }
}
```

---

## Полезные ссылки

- [Query DSL — Elasticsearch Docs](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl.html)
- [Aggregations — Elasticsearch Docs](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations.html)
